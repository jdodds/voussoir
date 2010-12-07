/*jslint indent:2, browser:true, devel:true, maxlen:80 nomen:false */
/*global $ require __dirname process */
/* Copyright (c) 2010 Jeremiah Dodds <jeremiah.dodds@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

var sys = require('sys'),
url = require('url'),
fs = require('fs'),
http = require('http'),
path = require('path'),
events = require('events'),
child_process = require('child_process'),
Step = require('./step/lib/step'),
makefile_templ = [
  '#### Change these settings to modify how this ISO is built.',
  '#  The directory that you\'ll be using for the actual build process.',
  'WORKDIR=work',
  '#  A list of packages to install, either space separated in a string or line separated in a file. Can include groups.',
  'PACKAGES="$(shell cat packages.list) syslinux"',
  '# The name of our ISO. Does not specify the architecture!',
  'NAME=myarch',
  '# Version will be appended to the ISO.',
  'VER=1.00',
  '# Kernel version. You\'ll need this. Don\'t change it.',
  'kver_FILE=$(WORKDIR)/root-image/etc/mkinitcpio.d/kernel26.kver',
  '# Architecture will also be appended to the ISO name.',
  'ARCH?=x86_64',
  '# Current working directory',
  'PWD:=$(shell pwd)',
  '# This is going to be the full name the final iso/img will carry',
  'FULLNAME="$(PWD)"/$(NAME)-$(VER)-$(ARCH)',
  '# Default make instruction to build everything.',
  'all: myarch',
  '# The following will first run the base-fs routine before creating the final iso image.',
  'myarch: base-fs',
  '	mkarchiso -v -p syslinux iso "$(WORKDIR)" "$(FULLNAME)".iso',
  '# This is the main rule for make the working filesystem. It will run routines from left to right. ',
  '# Thus, root-image is called first and syslinux is called last.',
  'base-fs: root-image boot-files initcpio overlay iso-mounts syslinux',
  '# The root-image routine is always executed first. ',
  '# It only downloads and installs all packages into the $WORKDIR, giving you a basic system to use as a base.',
  'root-image: "$(WORKDIR)"/root-image/.arch-chroot',
  '"$(WORKDIR)"/root-image/.arch-chroot:',
  'root-image:',
  '	mkarchiso -v -p $(PACKAGES) create "$(WORKDIR)"',
  '# Rule for make /boot',
  'boot-files: root-image',
  '	cp -r "$(WORKDIR)"/root-image/boot "$(WORKDIR)"/iso/',
  '	cp -r boot-files/* "$(WORKDIR)"/iso/boot/',
  '# Rules for initcpio images',
  'initcpio: "$(WORKDIR)"/iso/boot/myarch.img',
  '"$(WORKDIR)"/iso/boot/myarch.img: mkinitcpio.conf "$(WORKDIR)"/root-image/.arch-chroot',
  '	mkdir -p "$(WORKDIR)"/iso/boot',
  '	mkinitcpio -c ./mkinitcpio.conf -b "$(WORKDIR)"/root-image -k $(shell grep ^ALL_kver $(kver_FILE) | cut -d= -f2) -g $@',
  '# See: Overlay',
  'overlay:',
  '	mkdir -p "$(WORKDIR)"/overlay/etc/pacman.d',
  '	cp -r overlay "$(WORKDIR)"/',
  '	wget -O "$(WORKDIR)"/overlay/etc/pacman.d/mirrorlist http://www.archlinux.org/mirrorlist/all/',
  '	sed -i "s/#Server/Server/g" "$(WORKDIR)"/overlay/etc/pacman.d/mirrorlist',
  '# Rule to process isomounts file.',
  'iso-mounts: "$(WORKDIR)"/isomounts',
  '"$(WORKDIR)"/isomounts: isomounts root-image',
  '	sed "s|@ARCH@|$(ARCH)|g" isomounts > $@',
  '# This routine is always executed just before generating the actual image. ',
  'syslinux: root-image',
  '	mkdir -p $(WORKDIR)/iso/boot/syslinux',
  '	cp $(WORKDIR)/root-image/usr/lib/syslinux/*.c32 $(WORKDIR)/iso/boot/syslinux/',
  '	cp $(WORKDIR)/root-image/usr/lib/syslinux/isolinux.bin $(WORKDIR)/iso/boot/syslinux/',
  '# In case "make clean" is called, the following routine gets rid of all files created by this Makefile.',
  'clean:',
  '	rm -rf "$(WORKDIR)" "$(FULLNAME)".img "$(FULLNAME)".iso',
  '.PHONY: all myarch',
  '.PHONY: base-fs',
  '.PHONY: root-image boot-files initcpio overlay iso-mounts',
  '.PHONY: syslinux',
  '.PHONY: clean'
].join("\n"),
isomounts_tmpl = [
  'overlay.sqfs @ARCH@ / squashfs',
  'root-image.sqfs @ARCH@ / squashfs',
  '' // this is needed to avoid a kernel panic!
].join("\n"),
syslinux_cfg_tmpl = [
  'prompt 1',
  'timeout 0',
  'display myarch.msg',
  'DEFAULT myarch',
  '',
  'LABEL myarch',
  'KERNEL /boot/vmlinuz26',
  'APPEND initrd=/boot/myarch.img archisolabel=XXX locale=en_US.UTF-8',
  ''
].join("\n"),
fstab_tmpl = [
  'aufs                   /             aufs      noauto              0      0',
  'none                   /dev/pts      devpts    defaults            0      0',
  'none                   /dev/shm      tmpfs     defaults            0      0',
  ''
].join("\n"),
mkinitcpio_tmpl = [
  'HOOKS="base udev archiso pata scsi sata usb fw filesystems usbinput"',
  ''
].join("\n"),
dir_perms = parseInt('755', 8),
server = http.createServer(function (request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, {
      Allow: 'POST',
      'Content-Type': 'text/plain'
    });
    response.end([
      "You don't seem to get it. You're the deliveryman. Deliverymen POST",
      "things, they don't", request.method, "them!\n"
    ].join(' '));
  } else {
    var post_data = "";
    request.on('data', function (chunk) {
      post_data += chunk;
    });
    request.on('end', function () {
      Step(
        function mkdir_working() {
          var date = new Date();
          this.user_data = JSON.parse(post_data);
          this.working_dir = [
            this.user_data.name,
            '-',
            date.getTime()
          ].join('');
          response.writeHead(202);
          sys.puts(JSON.stringify(this.user_data));
          response.end();
          fs.mkdir(this.working_dir, dir_perms, this);
        },
        function write_makefile(err) {
          if (err) {
            throw err;
          }
          var makefile = path.join(this.working_dir, 'Makefile');
          fs.writeFile(makefile, makefile_templ, this);
        },
        function write_mkinitcpio(err) {
          if (err) {
            throw err;
          }
          var mkinitcpio = path.join(this.working_dir, 'mkinitcpio.conf');
          fs.writeFile(mkinitcpio, mkinitcpio_tmpl, this);
        },
        function write_packages_list(err) {
          if (err) {
            throw err;
          }
          var packages = path.join(this.working_dir, 'packages.list');
          fs.writeFile(packages, this.user_data.packages.join("\n"), this);
        },
        function write_isomounts(err) {
          if (err) {
            throw err;
          }
          var isomounts = path.join(this.working_dir, 'isomounts');
          fs.writeFile(isomounts, isomounts_tmpl, this);
        },
        function mkdir_bootfiles(err) {
          if (err) {
            throw err;
          }
          this.bootfiles = path.join(this.working_dir, 'boot-files');
          fs.mkdir(this.bootfiles, dir_perms, this);
        },
        function mkdir_syslinux(err) {
          this.syslinux = path.join(this.bootfiles, 'syslinux');
          fs.mkdir(this.syslinux, dir_perms, this);
        },
        function write_syslinux_cfg(err) {
          if (err) {
            throw err;
          }
          this.syslinux_cfg = path.join(this.syslinux, 'syslinux.cfg');
          fs.writeFile(this.syslinux_cfg, syslinux_cfg_tmpl, this);
        },
        function write_bootmsg(err) {
          if (err) {
            throw err;
          }
          var message = path.join(this.syslinux, 'myarch.msg');
          fs.writeFile(message, this.user_data.boot_message.join("\n"), this);
        },
        function mkdir_overlay(err) {
          if (err) {
            throw err;
          }
          this.overlay = path.join(this.working_dir, 'overlay');
          fs.mkdir(this.overlay, dir_perms, this);
        },
        function mkdir_etc(err) {
          if (err) {
            throw err;
          }
          this.etc = path.join(this.overlay, 'etc');
          fs.mkdir(this.etc, dir_perms, this);
        },
        function write_fstab(err) {
          var fstab = path.join(this.etc, 'fstab');
          fs.writeFile(fstab, fstab_tmpl, this);
        },
        function get_cwd(err) {
          if (err) {
            throw err;
          }
          this.env = process.env;
          this.env.SHELL = '/bin/bash';
          this.env._ = '/usr/bin/env';
          fs.realpath(this.working_dir, this);
        },
        function spin(err, cwd) {
          if (err) {
            throw err;
          }
          this.env.cwd = cwd;
          var maker = child_process.spawn(
            'make', ['all'], this.env
          ),
          user_data = this.user_data;
          
          maker.on('exit', function (code) {
            sys.puts(user_data.name + ' finished with code: ' + code);
          });
          maker.stdout.on('data', function (data) {
            sys.puts(user_data.name + ' ' + data);
          });
          maker.stderr.on('data', function (data) {
            sys.puts(user_data.name + ' ERROR:: ' + data);
          });
        }
      );
    });
  }
});

server.listen('8080');
/*jslint indent:2, browser:true, devel:true, maxlen:80 nomen:false */
/*global $ require __dirname */
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
spawn = require('child_process').spawn,
archiso_base = path.join(__dirname, 'archiso'),
copy_tracker = new events.EventEmitter(),
copy_directory = function (the_path, dest_path) {
  fs.readdir(the_path, function (err, files) {
    copy_tracker.emit('start_dir', files.length);
    files.forEach(function (file) {
      var the_file = path.join(the_path, file);
      fs.stat(the_file, function (err, stats) {
        var dest_file = path.join(dest_path, file);
        if (stats.isDirectory()) {
          fs.mkdir(dest_file, 0777, function (err) {
            copy_tracker.emit('written');
            copy_directory(the_file, dest_file);
          });
        } else {
          fs.readFile(the_file, function (err, data) {
            fs.writeFile(dest_file, data, function (err) {
              copy_tracker.emit('written');
            });
          });
        }
      });
    });
  });
},
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
      var user_data = JSON.parse(post_data),
      date = new Date(),
      working_dir = [user_data.name, '-', date.getTime()].join('');

      response.writeHead(202);
      sys.puts(JSON.stringify(user_data));
      response.end();
      fs.mkdir(working_dir, 0777, function (err) {
        var make_dir = path.join(working_dir, 'configs/syslinux-iso'),
        num_files = 0,
        done_files = 0;
        copy_tracker.on('start_dir', function (num) {
          num_files += num;
        });
        copy_tracker.on('written', function () {
          done_files += 1;
          if (done_files === num_files) {
            fs.chmod(
              path.join(make_dir, 'download-repo.sh'),
              0755,
              function (err) {
                fs.writeFile(
                  path.join(make_dir, 'packages.' + user_data.arch),
                  user_data.packages.join('\n'),
                  function (err) {
                    var maker = spawn(
                      'make', [],
                      {'cwd': fs.realpathSync(make_dir)}
                    );
                    maker.on('exit', function (code) {
                      sys.puts('finished with code: ' + code);
                    });
                    maker.stdout.on('data', function (data) {
                      sys.puts(user_data.name + ' ' + data);
                    });
                    maker.stderr.on('data', function (data) {
                      sys.puts(user_data.name + ' ERR: ' + data);
                    });
                  }
                );
              }
            );
          }
        });
        copy_directory(archiso_base, working_dir);
      });
    });
  }
});

server.listen('8080');
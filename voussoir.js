/*jslint indent:2, browser:true, devel:true, maxlen:80 nomen:false */
/*global $ require __dirname */
var sys = require('sys'),
url = require('url'),
fs = require('fs'),
http = require('http'),
path = require('path'),
archiso_base = path.join(__dirname, 'archiso'),
copy_directory = function (the_path, dest_path) {
  fs.readdir(the_path, function (err, files) {
    files.forEach(function (file) {
      var the_file = path.join(the_path, file);
      fs.stat(the_file, function (err, stats) {
        var dest_file = path.join(dest_path, file);
        if (stats.isDirectory()) {
          fs.mkdir(dest_file, 0777, function (err) {
            copy_directory(the_file, dest_file);
          });
        } else {
          fs.readFile(the_file, function (err, data) {
            sys.puts(dest_file);
            fs.writeFile(dest_file, data, function (err) {

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
      var data = JSON.parse(post_data),
      date = new Date(),
      working_dir = [data.name, '-', date.getTime()].join('');

      response.writeHead(202);
      sys.puts(JSON.stringify(data));
      response.end();
      fs.mkdir(working_dir, 0777, function (err) {
        copy_directory(archiso_base, working_dir);
      });
    });
  }
});

server.listen('8080');
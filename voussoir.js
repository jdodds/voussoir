/*jslint indent:2, browser:true, devel:true, maxlen:80 nomen:false */
/*global $ require */
var sys = require('sys'),
url = require('url'),
http = require('http');

var server = http.createServer(function (request, response) {
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
      var data = JSON.parse(post_data);
      response.writeHead(202);
      sys.puts(JSON.stringify(data));
      response.end();
    });
  }
});

server.listen('8080');
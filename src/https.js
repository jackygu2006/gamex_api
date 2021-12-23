import { apiBaseUrl } from './config.js';
import fs from 'fs';
import http from 'http';
import https from 'https';
import express from 'express';

var privateKey  = fs.readFileSync('sslcert/server.key', 'utf8');
var certificate = fs.readFileSync('sslcert/server.pem', 'utf8');

var credentials = {key: privateKey, cert: certificate};
const app = express();

// your express configuration here
app.get(apiBaseUrl + '/test', function (req, res) {
	res.send('Hello World!');
})

const httpServer = http.createServer(app);
const httpsServer = https.createServer(credentials, app);

httpServer.listen(8081);
httpsServer.listen(8443);
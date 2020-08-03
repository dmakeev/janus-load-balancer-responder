const http = require('http');
const io = require('socket.io')();
const shell = require('shelljs');
const fs = require('fs');
const path = require('path');
// const AWS = require('aws-sdk');
const axios = require('axios');
const publicIp = require('public-ip');
const config = require('getconfig');

class Responder {

    constructor(ownIp) {
        const self = this;
        const httpServer = http.createServer();
        httpServer.listen(config.server.portSocket);
        io.listen(httpServer);

        self.ip = ownIp;
        self.registerEvents(); 
        self.propagateMyself();
        console.log(`Janus responder started at ${ownIp}:${config.server.portSocket}`);
    }

    /**
     * Add this instance to load balancer's pool
     * 
     */
    propagateMyself() {
        const self = this;
        axios.post(`${config.balancer.url}/balancer/janus/add`, {
            SSL: config.janus.useSSL,
            host: self.ip,
            portHttp: config.janus.portHttp,
            portWebsocket: config.janus.portWebsocket,
            portResponder: config.server.portSocket,
            apiSecret: config.janus.apiSecret
        }).then(function (response) {
            console.log('Successfuly added to load balancer`s pool');
        }).catch(function (error) {
            console.error(error.message);
        });
    }

    /**
     * Register socket.io events
     * 
     */
    registerEvents() {
        const self = this;
        io.sockets.on('connection', (socket) => {
            socket.on('/v1/load/cpu', () => {
                socket.emit('cpu', { 'code': 200, 'message': '', 'data': self.getCPU() });
            });
            socket.on('/v1/stream/finish', (input, callback) => {
                self.finishStream(input.streamId, input.directory, input.credentials, (err, filename, blobname, url) => {
                    callback({error: err, filename, blobname, url});
                });
            });
        });
    }

    /**
     * Get actual CPU load 
     * 
     */
    getCPU() {
        result = {};
        const getted = shell.exec("TERM=vt100 top -b -n 1 | grep 'load average: '", {'silent': true});
        if (getted && getted.stdout) {
            const usage = getted.stdout.match(/([\d\.]+),\s([\d\.]+),\s([\d\.]+)/, '');
            result.loadAverage = usage[1];
        }
        return result;
    }

    /**
    * Process video
    *
    * @param    streamId                uuid
    * @param    recordingsDirectory     string      directory with recording files 
    * @param    credentials             object      blob storage credentials
    * @param    callback                function
    */
    finishStream = (streamId, recordingsDirectory, credentials, callback) => {
        const self = this;
        // Define file names
        const sourceAudio = recordingsDirectory + '/'  + streamId + '-audio.mjr';
        const recording = recordingsDirectory + '/'  + streamId + '.mp3';
        if (!fs.existsSync(sourceAudio)) {
            console.error(`No source audio file found for stream ${streamId}`);
            return callback('No source audio file found');
        }
        // Convert audio stream from Janus format
        const command = config.recording.converter + ' -f opus ' + sourceAudio + ' ' + recording;
        shell.exec(command, {async:true, silent:true}, (code, stdout, stderr) => {
            if (code) {
                console.error(stdout);
                console.error(stderr);
                console.error(`Error in processing source audio file for stream ${streamId}: ${stdout}`);
                return callback('Error in processing source audio file');
            }
            // Remove temporary files
            fs.unlink(sourceAudio, ()=>{});
            // Upload the recording to blob
            process.env.AWS_SDK_LOAD_CONFIG = 1;
            process.env.AWS_ACCESS_KEY_ID = credentials.accessKeyId;
            process.env.AWS_SECRET_ACCESS_KEY = credentials.accessSecretKey;
            AWS.config.update(credentials);
            setTimeout(() => {
                self.uploadToBlob(recording, credentials, (err, filename, blobname, url) => {
                    // Callback
                    fs.unlink(recording, ()=>{});
                    callback(err, filename, blobname, url);
                });
            }, 1000);
        });
    }

    /**
    * Upload the resulting video to blob storage
    *
    * @param    recording   string
    * @param    credentials object      blob storage credentials
    * @param    callback    function
    */
    uploadToBlob = (recording, credentials, callback) => {
        const self = this;
        const bucket = credentials.bucket;
        const s3 = new AWS.S3();
        fs.readFile(recording, (err, data) => {
            if (err) {
                console.error(err);
            }
            const filename = path.basename(recording);
            const params = {
                Bucket: bucket,
                Key: filename,
                Body: data
            };
            s3.upload(params, function(err, data) {
                if (err) {
                    console.error(err);
                }
                var params = {Bucket: bucket, Key: filename};
                var url = s3.getSignedUrl('getObject', params);
                console.log(`File uploaded successfully at ${url}`);
                return callback(err, path.basename(recording), data.Location, url);
            });
         });
    }
}

// Catch all uncatched exceptions
process.on('uncaughtException', e => {
    console.error(e);
});

(async () => {
    const externalIp = await publicIp.v4();
    const responder = new Responder(externalIp);
})();
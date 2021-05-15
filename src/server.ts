/**
 * Responder for Janus load balancer
 *
 * @author Daniil Makeev / daniil-makeev@yandex.ru
 * @copyright https://github.com/dmakeev/janus-balancer-responder
 */

import * as config from 'getconfig';
import * as http from 'http';
import io from 'socket.io-client';
import axios, { AxiosResponse, AxiosError } from 'axios';
import publicIp from 'public-ip';
import shell from 'shelljs';

class Responder {
    private ip: string;
    private io: any;
    private loadBalancerConnected: boolean = false;

    constructor(ownIp: string) {
        const self: Responder = this;
        const httpServer = http.createServer();
        self.io = io(httpServer);
        httpServer.listen(config.server.portSocket);

        self.ip = ownIp;
        self.registerEvents();
        setTimeout(() => {
            self.propagateMyself();
        }, 1000);
        setInterval(() => {
            self.propagateMyself();
        }, 10000);
        console.log(`Janus responder started at ${ownIp}:${config.server.portSocket}`);
    }

    /**
     * Add this instance to load balancer's pool
     *
     */
    propagateMyself() {
        const self: Responder = this;
        axios
            .post(`${config.balancer.url}/balancer/janus/add`, {
                SSL: config.janus.useSSL,
                host: self.ip,
                portHttp: config.janus.portHttp,
                portWebsocket: config.janus.portWebsocket,
                portResponder: config.server.portSocket,
                apiSecret: config.janus.apiSecret,
                enabled: true,
            })
            .then((response) => {
                if (!response.data) {
                    self.loadBalancerConnected = false;
                    return console.log('Can`t connect to the load balancer');
                }
                if (!response.data.success) {
                    self.loadBalancerConnected = false;
                    return console.log(response.data.error);
                }
                if (!self.loadBalancerConnected) {
                    self.loadBalancerConnected = true;
                    console.log('Successfuly added to load balancer`s pool');
                }
            })
            .catch((error: AxiosError) => {
                console.error('Responder request error', error.message);
            });
    }

    /**
     * Register socket.io events
     *
     */
    registerEvents() {
        const self: Responder = this;
        self.io.on('connection', (socket) => {
            if (config.balancer.ip && socket.handshake.address !== config.balancer.ip) {
                return socket.disconnect();
            }
            self.io.on('/v1/load/cpu', (data, callback) => {
                callback({ status: 'connected', loadAverage: self.getCPU() });
            });
        });
    }

    /**
     * Get actual CPU load
     *
     */
    getCPU() {
        const getted = shell.exec("TERM=vt100 top -b -n 1 | grep 'load average: '", { silent: true });
        if (getted && getted.stdout) {
            const usage = getted.stdout.match(/([\d\.]+),\s([\d\.]+),\s([\d\.]+)/, '');
            return usage[1];
        }
    }
}

// Catch all uncatched exceptions
process.on('uncaughtException', (e) => {
    console.error(e);
});

(async () => {
    const externalIp = await publicIp.v4();
    new Responder(externalIp);
})();

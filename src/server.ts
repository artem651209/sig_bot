import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { Candle, get_kline,updateMAS } from './analysis.js';
import { fileURLToPath } from 'url';
import path from 'path';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, '..', 'public')));

const intervals = ['1m', '15m', '1h', '1d'];

intervals.forEach(interval => {
    app.get(`/${interval}`, (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'chart.html'));
    });
});

io.on('connection', (socket) => {
    console.log('a user connected');
    const { interval } = socket.handshake.query;
    if(!Array.isArray(interval)){
        const initial_data=get_kline(interval!)!
        io.emit('showInitialData', initial_data);
    }
    socket.on('disconnect', () => {
        console.log('user disconnected');
    });
    socket.on('addMA', async (data) => {
        const { period, interval } = data;
        await updateMAS(period, interval);
        
    });
});

export function updateCharts(candle: Candle, moved: boolean) {
    io.emit('update', candle, moved);
}

server.listen(3000, () => {
    console.log('listening on *:3000');
});


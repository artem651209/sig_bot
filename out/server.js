import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { get_kline, updateMAS, placeUserOrder, get_account } from './analysis.js';
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
    const { interval } = socket.handshake.query;
    if (!Array.isArray(interval)) {
        const initial_data = get_kline(interval);
        const initial_acc = get_account();
        io.emit('showInitialData', initial_data, initial_acc);
    }
    socket.on('disconnect', () => {
        console.log('user disconnected');
    });
    socket.on('addMA', async (data) => {
        const { period, interval } = data;
        await updateMAS(period, interval);
    });
    socket.on('palceOrder', async (data) => {
        placeUserOrder(data);
    });
    console.log('a user connected');
});
export function updateCharts(candle, moved) {
    io.emit('update', candle, moved);
}
export function updateBalances(acc_info) {
    io.emit('upd_acc', acc_info);
}
server.listen(3000, () => {
    console.log('listening on *:3000');
});

import { Interval, Spot, Side, OrderType, TimeInForce } from '@binance/connector-typescript';
import { WebsocketClient } from 'binance';
import { updateCharts, updateBalances } from './server.js';
import { rsi, sma, macd, bollingerbands } from 'technicalindicators';
import { DateTime } from 'luxon';
import { notify } from './tgbot.js';
import * as dotenv from 'dotenv';
dotenv.config({ path: 'out/config/.env' });
let b_api_key;
let b_secret_key;
let api_client;
let candleWS;
let userWS;
const use_test = false;
if (use_test) {
    b_api_key = process.env.B_TEST_KEY;
    b_secret_key = process.env.B_TEST_SEC_KEY;
    api_client = new Spot(b_api_key, b_secret_key, { baseURL: 'https://testnet.binance.vision' });
    candleWS = new WebsocketClient({ api_key: b_api_key, api_secret: b_secret_key, beautify: false, wsUrl: 'wss://stream.testnet.binance.vision/ws' });
    userWS = new WebsocketClient({ api_key: b_api_key, api_secret: b_secret_key, beautify: false, wsUrl: 'wss://stream.testnet.binance.vision/ws' });
}
else {
    b_api_key = process.env.B_API_KEY;
    b_secret_key = process.env.B_SEC_KEY;
    api_client = new Spot(b_api_key, b_secret_key);
    candleWS = new WebsocketClient({ api_key: b_api_key, api_secret: b_secret_key, beautify: false });
    userWS = new WebsocketClient({ api_key: b_api_key, api_secret: b_secret_key, beautify: false });
}
let cid;
let btc_dom_int_id;
let klines = [];
export const current_account = {
    current_pair: '',
    base_curr: '',
    quote_curr: '',
    base_balance: 0,
    quote_balance: 0,
    prev_balance: 0,
    minnot: 0
};
const user_LK = api_client.createListenKey();
candleWS.on('open', (data) => {
    console.log('connection opened open');
});
candleWS.on('reply', (data) => {
    console.log('log reply: ', JSON.stringify(data, null, 2));
});
candleWS.on('reconnecting', (data) => {
    console.log('ws automatically reconnecting.... ', data?.wsKey);
});
candleWS.on('reconnected', (data) => {
    console.log('ws has reconnected ', data?.wsKey);
});
async function update_indicators(current_candle) {
    await calculate_ma(current_candle);
    await calculate_crsi(current_candle);
    await calculate_macd(current_candle);
    await calculate_BB(current_candle);
}
async function getMarketCap() {
    try {
        const btcResponse = await api_client.ticker24hr({ symbol: 'BTCUSDT' });
        let btcMarketCap = 0;
        if (!Array.isArray(btcResponse)) {
            btcMarketCap = parseFloat(btcResponse.quoteVolume) * parseFloat(btcResponse.lastPrice);
        }
        const allTickersResponse = await api_client.ticker24hr();
        let totalMarketCap = 0;
        if (Array.isArray(allTickersResponse)) {
            totalMarketCap = allTickersResponse.reduce((sum, ticker) => {
                return sum + (parseFloat(ticker.quoteVolume) * parseFloat(ticker.lastPrice));
            }, 0);
        }
        return { btcMarketCap, totalMarketCap };
    }
    catch (error) {
        console.error('Ошибка при получении данных о рыночной капитализации:', error);
        throw error;
    }
}
async function getBtcDominance() {
    const { btcMarketCap, totalMarketCap } = await getMarketCap();
    return (btcMarketCap / totalMarketCap) * 100;
}
async function getBtcPrice() {
    const response = await api_client.symbolPriceTicker({ symbol: 'BTCUSDT' });
    return Array.isArray(response) ? parseFloat(response[0].price) : parseFloat(response.price);
}
async function compare(btcp, domp, cbtcp, cdom) {
    let message;
    if (cdom > domp && cbtcp > btcp) {
        message = 'Доминация и цена на биток РАСТУТ - альты вероятно будут ПАДАТЬ';
    }
    else if (cdom > domp && cbtcp < btcp) {
        message = 'Доминация РАСТЕТ а цена на биток ПАДАЕТ - наступает фаза ДАМПА для альтов (цены сильно падают)';
    }
    else if (cdom > domp && cbtcp === btcp) {
        message = 'Доминация РАСТЕТ а цена на биток СТАБИЛИЗИРУЕТСЯ - альты СТАБИЛИЗИРУЮТСЯ (накапливаем)';
    }
    else if (cdom < domp && cbtcp > btcp) {
        message = 'Доминация ПАДАЕТ а цена на биток РАСТЕТ - наступает фаза АЛЬТСЕЗОНА (цены на альты быстро растут)';
    }
    else if (cdom < domp && cbtcp < btcp) {
        message = 'Доминация и цена биток ПАДАЕТ - цена на альты СТАБИЛИЗИРУЮТСЯ';
    }
    else {
        message = 'Доминация ПАДАЕТ а цена СТАБИЛИЗИРУЕТСЯ - цена на альты ПОДНИМАЕТСЯ';
    }
    return message;
}
async function btc_dominance_state() {
    let previousBtcDominance = await getBtcDominance();
    let previousBtcPrice = await getBtcPrice();
    setTimeout(async () => {
        const curr_btc_p = await getBtcPrice();
        const curr_btc_dom = await getBtcDominance();
        notify(cid, await compare(previousBtcPrice, previousBtcDominance, curr_btc_p, curr_btc_dom));
        previousBtcDominance = curr_btc_dom;
        previousBtcPrice = curr_btc_p;
    }, 60000);
    btc_dom_int_id = setInterval(async () => {
        const curr_btc_p = await getBtcPrice();
        const curr_btc_dom = await getBtcDominance();
        notify(cid, await compare(previousBtcPrice, previousBtcDominance, curr_btc_p, curr_btc_dom));
        previousBtcDominance = curr_btc_dom;
        previousBtcPrice = curr_btc_p;
    }, 3600000);
}
const lastSignals = {};
async function signal_pattern(kline, interv) {
    const macd_length = kline.macd.length;
    const cur_macd = kline.macd[macd_length - 1];
    const prev_macd = kline.macd[macd_length - 2];
    const rsi_length = kline.rsi.values.length;
    const cur_rsi = kline.rsi.values[rsi_length - 1];
    const prev_rsi = kline.rsi.values[rsi_length - 2];
    const prev_price = kline.close_prices[kline.close_prices.length - 2];
    const cur_price = kline.close_prices[kline.close_prices.length - 1];
    const cur_bb = kline.bb[kline.bb.length - 1];
    const prev_bb = kline.bb[kline.bb.length - 2];
    const bb_uppers = [cur_bb._upper, prev_bb._upper];
    const bb_lowers = [cur_bb._lower, prev_bb._lower];
    //\n MACD:${cur_macd} ${prev_macd}\n RSI:${cur_rsi} ${prev_price}\n PRICE:${cur_price} ${prev_price}`)
    const signals = {
        macd_up: prev_macd._macd <= prev_macd._signal && cur_macd._macd > cur_macd._signal,
        macd_down: prev_macd._macd >= prev_macd._signal && cur_macd._macd < cur_macd._signal,
        rsi_up: prev_rsi <= 30 && cur_rsi > 30,
        rsi_down: prev_rsi >= 70 && cur_rsi < 70,
        bb_x_top: cur_price > bb_uppers[0] && prev_price <= bb_uppers[1],
        bb_x_bot: cur_price < bb_lowers[0] && prev_price >= bb_lowers[1],
        bb_contr: bb_uppers[1] - bb_lowers[1] > bb_uppers[0] - bb_lowers[0],
        bb_expan: bb_uppers[1] - bb_lowers[1] < bb_uppers[0] - bb_lowers[0]
    };
    const interval = interv;
    if (!lastSignals[interval]) {
        lastSignals[interval] = {
            macd: null,
            rsi: null,
            bb_x: null,
            bb_ce: null
        };
    }
    if (signals.bb_x_top) {
        if (lastSignals[interval].bb_x != 'top') {
            notify(cid, `На свече с интервалом ${interval} график цены пересёк ВЕРХНЮЮ ленту СНИЗУ ВВЕРХ.\n\nВОЗМОЖНО ПОРА ПРОДАВАТЬ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].bb_x = 'top';
        }
    }
    else if (signals.bb_x_bot) {
        if (lastSignals[interval].bb_x != 'bot') {
            notify(cid, `На свече с интервалом ${interval} график цены пересёк НИЖНЮЮ ленту СВЕРХУ ВНИЗ.\n\nВОЗМОЖНО ПОРА ПОКУПАТЬ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].bb_x = 'bot';
        }
    }
    if (signals.bb_contr) {
        if (lastSignals[interval].bb_ce != '-><-') {
            notify(cid, `На свече с интервалом ${interval} ЛЕНТЫ начали СУЖАТЬСЯ.\n\nОЖИДАЕТСЯ СИЛЬНОЕ ДВИЖЕНИЕ ЦЕНЫ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].bb_ce = '-><-';
        }
    }
    else if (signals.bb_expan) {
        if (lastSignals[interval].bb_ce != '<-->') {
            notify(cid, `На свече с интервалом ${interval} ЛЕНТЫ начали РАСХОДИТЬСЯ.\n\nСИЛЬНОЕ ДВИЖЕНИЕ ЦЕНЫ ПОДТВЕРЖДАЕТСЯ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].bb_ce = '<-->';
        }
    }
    if (signals.macd_up) {
        if (lastSignals[interval].macd !== 'up') {
            notify(cid, `На свече с интервалом ${interval} MACD пересекла сигнальную СНИЗУ ВВЕРХ.\n\nЦЕНА ДОЛЖНА ПОЙТИ ВВЕРХ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].macd = 'up';
        }
    }
    else if (signals.macd_down) {
        if (lastSignals[interval].macd !== 'down') {
            notify(cid, `На свече с интервалом ${interval} MACD пересекла сигнальную СВЕРХУ ВНИЗ.\n\nЦЕНА ДОЛЖНА ПОЙТИ ВНИЗ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].macd = 'down';
        }
    }
    if (signals.rsi_up) {
        if (lastSignals[interval].rsi !== 'up') {
            notify(cid, `На свече с интервалом ${interval} RSI ПРОБИЛО УРОВЕНЬ ПОДДЕРЖКИ СНИЗУ ВВЕРХ.\n\nВОЗМОЖНО ПОРА ПОКУПАТЬ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].rsi = 'up';
        }
    }
    else if (signals.rsi_down) {
        if (lastSignals[interval].rsi !== 'down') {
            notify(cid, `На свече с интервалом ${interval} RSI ПРОБИЛО УРОВЕНЬ СОПРОТИВЛЕНИЯ СВЕРХУ ВНИЗ.\n\nВОЗМОЖНО ПОРА ПРОДАВАТЬ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].rsi = 'down';
        }
    }
}
candleWS.on('message', async (data) => {
    if (!Array.isArray(data) && data.e === 'kline') {
        const ws_kline = data.k;
        const cur_kl = await klines.find(kline => kline.interval == ws_kline.i);
        if (cur_kl) {
            const last_element = cur_kl.close_time.length - 1;
            const clp = (typeof ws_kline.c == 'string') ? parseFloat(ws_kline.c) : ws_kline.c;
            const last_time = cur_kl.close_time[last_element];
            const ws_kl_et = DateTime.fromMillis(ws_kline.T).toISO();
            let move_flag = false;
            if (last_time != ws_kl_et) {
                cur_kl.close_prices.shift();
                cur_kl.close_prices.push(clp);
                cur_kl.close_time.shift();
                cur_kl.close_time.push(ws_kl_et);
                if (!lastSignals[ws_kline.i]) {
                    lastSignals[ws_kline.i] = {
                        macd: null,
                        rsi: null,
                        bb_x: null,
                        bb_ce: null
                    };
                }
                move_flag = true;
            }
            else {
                cur_kl.close_prices[last_element] = clp;
            }
            await update_indicators(cur_kl);
            await signal_pattern(cur_kl, ws_kline.i);
            updateCharts(cur_kl, move_flag);
        }
    }
});
userWS.on('message', (data) => {
    if (!Array.isArray(data) && data.e === 'executionReport') {
        const price = typeof (data.p) === "string" ? parseFloat(data.p) : data.p;
        const quantity = typeof (data.q) === "string" ? parseFloat(data.q) : data.q;
        const total = price * quantity;
        if (data.X === 'FILLED' && data.o === 'LIMIT') {
            updateBalances(current_account);
            const message = `Лимитный ордер на ${data.S} был исполнен:\nИсполненное количество: ${quantity}\nЦена исполнения: ${price}\nОбщая стоимость: ${total.toFixed(2)}`;
            notify(cid, message);
        }
        else if (data.o === 'LIMIT') {
            updateBalances(current_account);
            let statusMessage = '';
            if (data.X === 'CANCELED') {
                statusMessage = `Лимитный ордер на ${data.S} был отменен.`;
            }
            else if (data.X === 'REJECTED') {
                statusMessage = `Лимитный ордер на ${data.S} был отклонен.\nКод ошибки: ${data.X}`;
            }
            else {
                statusMessage = `Лимитный ордер на ${data.S} не был исполнен:\nУстановленная цена исполнения: ${price}\nКод ошибки: ${data.X}`;
            }
            notify(cid, statusMessage);
        }
    }
});
async function start_g_a(current_candle) {
    let close_p;
    let close_t;
    [close_p, close_t] = await get_kline_data(current_candle);
    current_candle.close_prices = close_p;
    current_candle.close_time = close_t;
    await update_indicators(current_candle);
    current_candle.fibonacci_levels = {
        '0%': 0,
        '23.6%': 0,
        '38.2%': 0,
        '50%': 0,
        '61.8%': 0,
        '100%': 0
    };
    await updateCharts(current_candle, false);
    candleWS.subscribeSpotKline(current_account.current_pair, current_candle.interval);
    userWS.subscribeSpotUserDataStreamWithListenKey((await user_LK).listenKey, false);
}
async function calculate_ma(kline) {
    await kline.mas?.forEach(ma => {
        ma.values = sma({ period: ma.period, values: kline.close_prices });
    });
}
async function calculate_macd(kline) {
    const _fastPeriod = kline.macd_periods[0];
    const _slowPeriod = kline.macd_periods[1];
    const _signalPeriod = kline.macd_periods[2];
    const macdOut = await macd({
        values: kline.close_prices, fastPeriod: _fastPeriod, slowPeriod: _slowPeriod, signalPeriod: _signalPeriod,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    kline.macd = await macdOut.map(out => { return { _macd: out['MACD'], _histogram: out['histogram'], _signal: out['signal'] }; });
}
async function calculate_crsi(kline) {
    if (kline.rsi?.period) {
        kline.rsi.values = await rsi({ period: kline.rsi.period, values: kline.close_prices });
    }
    ;
}
async function calculate_BB(kline) {
    try {
        if (kline.close_prices.length >= kline.bb_config.period) {
            const bbOut = bollingerbands({ period: kline.bb_config.period, stdDev: kline.bb_config.dev, values: kline.close_prices });
            kline.bb = bbOut.map(out => {
                return { _middle: out["middle"], _upper: out["upper"], _lower: out["lower"] };
            });
        }
        else {
            console.error("Insufficient data for Bollinger Bands calculation");
        }
    }
    catch (error) {
        console.error("Error calculating Bollinger Bands:", error);
    }
}
async function get_kline_data(kline) {
    let historical_klines;
    historical_klines = await api_client.klineCandlestickData(current_account.current_pair, kline.interval, { limit: kline.load_quantity, endTime: new Date().getTime() });
    const close_p = historical_klines.map((kline) => { return Number(kline[4]); });
    const close_t = historical_klines.map((kline) => { return DateTime.fromMillis(kline[6]).toISO(); });
    return [close_p, close_t];
}
export async function update_pair(pair) {
    current_account.current_pair = pair;
}
export async function upd_acc_info(start) {
    try {
        const acc = await api_client.accountInformation({ recvWindow: 10000 });
        let acc_info = acc.balances;
        if (start) {
            let base_ass = acc_info.find(ass => ass.asset === current_account.current_pair.slice(0, -4));
            if (base_ass) {
                current_account.base_curr = current_account.current_pair.slice(0, -4);
                current_account.base_balance = parseFloat(base_ass.free);
            }
            else {
                base_ass = acc_info.find(ass => ass.asset === current_account.current_pair.slice(0, -3));
                if (base_ass) {
                    current_account.base_curr = current_account.current_pair.slice(0, -3);
                    current_account.base_balance = parseFloat(base_ass.free);
                }
            }
            let quote_ass = acc_info.find(ass => ass.asset === current_account.current_pair.slice(-4));
            if (quote_ass) {
                current_account.quote_curr = current_account.current_pair.slice(-4);
                current_account.quote_balance = parseFloat(quote_ass.free);
            }
            else {
                quote_ass = acc_info.find(ass => ass.asset === current_account.current_pair.slice(-3));
                if (quote_ass) {
                    current_account.quote_curr = current_account.current_pair.slice(-3);
                    current_account.quote_balance = parseFloat(quote_ass.free);
                }
            }
            current_account.prev_balance = current_account.base_balance;
            current_account.minnot = await getMinNotional();
            console.log(current_account);
        }
        else {
            let base_ass = acc_info.find(ass => ass.asset === current_account.base_curr);
            let quote_ass = acc_info.find(ass => ass.asset === current_account.quote_curr);
            current_account.base_balance = parseFloat(base_ass.free);
            current_account.quote_balance = parseFloat(quote_ass.free);
            current_account.minnot = await getMinNotional();
        }
    }
    catch (e) {
        console.log(e);
        current_account.base_balance = 0;
    }
}
async function getMinNotional() {
    try {
        const symbol = current_account.current_pair;
        const exchangeInfo = await api_client.exchangeInformation({ symbol: symbol });
        const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === current_account.current_pair);
        if (!symbolInfo) {
            throw new Error(`Symbol ${symbol} not found.`);
        }
        const minNotionalFilter = symbolInfo.filters.find((f) => f.filterType === 'NOTIONAL');
        if (!minNotionalFilter) {
            throw new Error(`MIN_NOTIONAL filter not found for symbol ${symbol}.`);
        }
        return parseFloat(minNotionalFilter.minNotional);
    }
    catch (error) {
        console.log(error);
        return 0;
    }
}
export async function placeUserOrder(cur_order) {
    try {
        const action = cur_order.action == "BUY" ? Side.BUY : Side.SELL;
        const minNotional = current_account.minnot;
        if (minNotional > cur_order.total) {
            notify(cid, `Стоимость ордера меньше минимальной. Минимальная стоимость ордера:<code>${minNotional}</code>`);
        }
        else if (cur_order.type == "limit") {
            await api_client.newOrder(current_account.current_pair, action, OrderType.LIMIT, { timeInForce: TimeInForce.GTC, price: cur_order.price, quantity: cur_order.quantity, recvWindow: 10000 });
            await upd_acc_info(false);
            updateBalances(current_account);
            notify(cid, `Был выставлен лимитный ордер на ${cur_order.action}:\n Цена исполнения:${cur_order.price}\n Количество токенов ${current_account.base_curr}:${cur_order.quantity}\n Общая стомоимость ${current_account.quote_curr}:${cur_order.total}`);
        }
        else {
            await api_client.newOrder(current_account.current_pair, action, OrderType.MARKET, { quantity: cur_order.quantity, recvWindow: 10000 });
            await upd_acc_info(false);
            updateBalances(current_account);
            notify(cid, `Был исполнен рыночный ордер на ${cur_order.action}:\n Цена исполнения:${cur_order.price}\n Количество токенов ${current_account.base_curr}:${cur_order.quantity}\n Общая стомоимость ${current_account.quote_curr}:${cur_order.total}`);
        }
    }
    catch (e) {
        console.log(e);
        notify(cid, "Ошибка при выставлении ордера, глянь консоль");
    }
}
export function get_statistics() {
    upd_acc_info(false);
    const diff = current_account.base_balance - current_account.prev_balance;
    const pdiff = (diff / current_account.prev_balance) * 100;
    return `До запуска баланс выбранной монет составлял: ${current_account.prev_balance}\n Cейчас он составляет: ${current_account.base_balance}\n Разница: ${pdiff.toFixed(2)}%`;
}
const get_interval = (intrvl) => {
    switch (intrvl) {
        case '1m':
            return Interval['1m'];
        case '15m':
            return Interval['15m'];
        case '1h':
            return Interval['1h'];
        case '1d':
            return Interval['1d'];
        default:
            return Interval['1m'];
    }
};
export function get_kline(intervl) {
    return klines.find(candle => candle.interval === get_interval(intervl));
}
export function get_account() {
    return current_account;
}
export const stop_websocket = () => {
    clearInterval(btc_dom_int_id);
    candleWS.closeAll(false);
    userWS.closeAll(false);
};
export function processCandles(configuration, pair, curr_chat) {
    klines = [];
    cid = curr_chat;
    upd_acc_info(true);
    btc_dominance_state();
    current_account.current_pair = pair;
    configuration.forEach(config => {
        const temp_candle = {
            interval: get_interval(config.candleSize),
            load_quantity: config.quantity,
            close_prices: [],
            close_time: [],
            rsi: { period: config.rsiPeriod, values: [] },
            macd_periods: config.macdPeriods,
            mas: [],
            macd: [],
            bb_config: { period: config.BB_period, dev: config.BB_dev },
            bb: []
        };
        config.movingAverages?.forEach(ma => {
            temp_candle.mas?.push({ period: ma, values: [] });
        });
        klines.push(temp_candle);
    });
    klines.forEach(kline => start_g_a(kline));
}
export async function updateMAS(per, iner) {
    let curkl = get_kline(iner);
    if (curkl) {
        curkl.mas = curkl.mas || [];
        const newMA = { period: per, values: [] };
        curkl.mas.push(newMA);
        await calculate_ma(curkl);
    }
}

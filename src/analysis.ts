import { Interval, Spot} from '@binance/connector-typescript';
import { WebsocketClient } from 'binance';
import { updateCharts } from './server.js';
import { rsi, sma ,macd, bollingerbands} from 'technicalindicators';
import {DateTime} from 'luxon';
import {Candle_config,notify} from './tgbot.js';

const b_api_key:string='3UbaC4yHrNUYWOa7jgcOUfVOAqhR96rU17l7kfkeRb0JVHetCc1fyVJ3ff2VM2Qs';
const b_secret_key:string='gkXRy1EaJtBDiHKTrW6nSdIDSXkcCNrx4mIpnG5bThS31IULnDBCENzCSk42IOnk';

const b_test_key:string ='07V3W0aLnIZqqYjtSWg5rLCdLrlN1fVNyFGsGTQnAYh83Zd8RoiErJtJjXmzTZxX';
const b_test_sec_key:string='7gN9ZPF3RESML83OGbvywMLJAX31wg4Pgu88eHHFzA91EgFykv246jVxLyiKxoZ3';

let cid:string;
let btc_dom_int_id;
interface FibonacciLevels{
    '0%':number;
    '23.6%':number;
    '38.2%':number;
    '50%':number;
    '61.8%':number;
    '100%':number;
}
interface MovingAverageConvergenceDivergence{
    _macd?:number;
    _signal?:number;
    _histogram?:number;
}
interface BollBands{
    _middle?: number;
    _upper?: number;
    _lower?: number;
}
export interface Candle{
    interval:Interval;
    load_quantity:number;
    close_time:string[];
    fibonacci_levels?:FibonacciLevels;
    macd_periods:number[];
    macd:MovingAverageConvergenceDivergence[];
    close_prices:number[];
    mas?:{period:number,values:number[]}[];
    rsi:{period?:number,values:number[]};
    bb_config?:{
        period:number,
        dev:number
    }
    bb?:BollBands[];
}
const api_client:Spot=new Spot(b_api_key,b_secret_key);//,{baseURL:'https://testnet.binance.vision'}

const wsClient:WebsocketClient = new WebsocketClient({api_key: b_api_key,api_secret: b_secret_key,beautify:false});//,wsUrl:'wss://stream.testnet.binance.vision/ws'});

wsClient.on('open', (data) => {
console.log('connection opened open');
});
wsClient.on('reply', (data) => {
console.log('log reply: ', JSON.stringify(data, null, 2));
});
wsClient.on('reconnecting', (data) => {
console.log('ws automatically reconnecting.... ', data?.wsKey);
});
wsClient.on('reconnected', (data) => {
console.log('ws has reconnected ', data?.wsKey);
});
async function update_indicators(current_candle:Candle):Promise<void>{
    await calculate_ma(current_candle);
    await calculate_crsi(current_candle);
    await calculate_macd(current_candle);
    await calculate_BB(current_candle);
}
async function getMarketCap() {
    try {
        const btcResponse = await api_client.ticker24hr({symbol:'BTCUSDT'});
        let btcMarketCap=0;
        if(!Array.isArray(btcResponse)){
            btcMarketCap = parseFloat(btcResponse.quoteVolume) * parseFloat(btcResponse.lastPrice);
        }

        const allTickersResponse = await api_client.ticker24hr();
        let totalMarketCap=0;
        if(Array.isArray(allTickersResponse)){
            totalMarketCap = allTickersResponse.reduce((sum: number, ticker: any) => {
                return sum + (parseFloat(ticker.quoteVolume) * parseFloat(ticker.lastPrice));
            }, 0);
        }
        return { btcMarketCap, totalMarketCap };
    } catch (error) {
        console.error('Ошибка при получении данных о рыночной капитализации:', error);
        throw error;
    }
}
async function getBtcDominance() {
    const { btcMarketCap, totalMarketCap } = await getMarketCap();
    return (btcMarketCap / totalMarketCap) * 100;
}
async function getBtcPrice(): Promise<number> {
    const response = await api_client.symbolPriceTicker({symbol:'BTCUSDT'});
    return Array.isArray(response)? parseFloat(response[0].price):parseFloat(response.price);
}
async function compare(btcp:number,domp:number,cbtcp:number,cdom:number):Promise<string>{
    let message;
        if (cdom > domp && cbtcp > btcp) {
            message='Доминация и цена на биток РАСТУТ - альты вероятно будут ПАДАТЬ';
        } else if (cdom > domp && cbtcp < btcp) {
            message='Доминация РАСТЕТ а цена на биток ПАДАЕТ - наступает фаза ДАМПА для альтов (цены сильно падают)';
        } else if (cdom > domp && cbtcp === btcp) {
            message='Доминация РАСТЕТ а цена на биток СТАБИЛИЗИРУЕТСЯ - альты СТАБИЛИЗИРУЮТСЯ (накапливаем)';
        } else if (cdom < domp && cbtcp > btcp) {
            message='Доминация ПАДАЕТ а цена на биток РАСТЕТ - наступает фаза АЛЬТСЕЗОНА (цены на альты быстро растут)';
        } else if (cdom < domp && cbtcp < btcp) {
            message='Доминация и цена биток ПАДАЕТ - цена на альты СТАБИЛИЗИРУЮТСЯ';
        } else{
            message='Доминация ПАДАЕТ а цена СТАБИЛИЗИРУЕТСЯ - цена на альты ПОДНИМАЕТСЯ';
        }
    return message;
}
async function btc_dominance_state():Promise<void>{
    let previousBtcDominance: number = await getBtcDominance();
    let previousBtcPrice: number = await getBtcPrice();
    setTimeout(async()=>{
        const curr_btc_p=await getBtcPrice();
        const curr_btc_dom=await getBtcDominance();
        notify(cid,await compare(previousBtcPrice,previousBtcDominance,curr_btc_p,curr_btc_dom));
        previousBtcDominance=curr_btc_dom;
        previousBtcPrice=curr_btc_p;
    },60000)
    btc_dom_int_id=setInterval(async () =>{
        const curr_btc_p=await getBtcPrice();
        const curr_btc_dom=await getBtcDominance();
        notify(cid,await compare(previousBtcPrice,previousBtcDominance,curr_btc_p,curr_btc_dom));
        previousBtcDominance=curr_btc_dom;
        previousBtcPrice=curr_btc_p;
    },3600000)
}
const lastSignals: { [interv: string]: { macd: 'up' | 'down' | null, rsi: 'up' | 'down' | null } } = {};
async function signal_pattern(kline:Candle,interv:string){
    const macd_length=kline.macd.length;
    const cur_macd=kline.macd[macd_length-1];
    const prev_macd=kline.macd[macd_length-2];
    const rsi_length=kline.rsi.values.length;
    const cur_rsi=kline.rsi.values[rsi_length-1];
    const prev_rsi=kline.rsi.values[rsi_length-2];
    const signals = {
        macd_up: prev_macd._macd! <= prev_macd._signal! && cur_macd._macd! > cur_macd._signal!,
        macd_down: prev_macd._macd! >= prev_macd._signal! && cur_macd._macd! < cur_macd._signal!,
        rsi_up: prev_rsi <= 30 && cur_rsi > 30,
        rsi_down: prev_rsi >= 70 && cur_rsi < 70,
    };

    const interval = interv;
    if (!lastSignals[interval]) {
        lastSignals[interval] = {
            macd: null,
            rsi: null,
        };
    }

    if (signals.macd_up) {
        if (lastSignals[interval].macd !== 'up') {
            notify(cid, `На свече с интервалом ${interval} MACD пересекла сигнальную СНИЗУ ВВЕРХ.\n\nЦЕНА ДОЛЖНА ПОЙТИ ВВЕРХ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].macd = 'up';
        }
    } else if (signals.macd_down) {
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
    } else if (signals.rsi_down) {
        if (lastSignals[interval].rsi !== 'down') {
            notify(cid, `На свече с интервалом ${interval} RSI ПРОБИЛО УРОВЕНЬ СОПРОТИВЛЕНИЯ СВЕРХУ ВНИЗ.\n\nВОЗМОЖНО ПОРА ПРОДАВАТЬ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].rsi = 'down';
        }
    }
}

wsClient.on('message', async (data) => {
    if (!Array.isArray(data) && data.e === 'kline') {
      const ws_kline = data.k;
      const cur_kl = klines.find(kline => kline.interval==ws_kline.i);
      if(cur_kl){
        const last_element = cur_kl.close_time.length-1;
        const clp:number = (typeof ws_kline.c =='string')? parseFloat(ws_kline.c):ws_kline.c;
        const last_time:string = cur_kl.close_time[last_element];
        const ws_kl_et:string= DateTime.fromMillis(ws_kline.T).toISO()!;
        let move_flag:boolean=false;
        if(last_time!=ws_kl_et){
            cur_kl.close_prices.shift();
            cur_kl.close_prices.push(clp);
            cur_kl.close_time.shift();
            cur_kl.close_time.push(ws_kl_et);
            move_flag=true;
        }else{
            cur_kl.close_prices[last_element]=clp;
        }
        await update_indicators(cur_kl);
        updateCharts(cur_kl,move_flag);
        signal_pattern(cur_kl,ws_kline.i);
      }
    }
});
declare global{
    var current_pair:string;
    var current_balance:number;
}

let klines:Candle[]=[];

async function start_g_a(current_candle:Candle) {
    let close_p:number[];
    let close_t:string[];
    
    [close_p,close_t]=await get_kline_data(current_candle);
    current_candle.close_prices=close_p;
    current_candle.close_time=close_t;
    await update_indicators(current_candle);
    current_candle.fibonacci_levels={
        '0%':0,
        '23.6%': 0,
        '38.2%': 0,
        '50%': 0,
        '61.8%': 0,
        '100%':0
    };
    await updateCharts(current_candle,false);
    wsClient.subscribeSpotKline(current_pair,current_candle.interval);
}
async function calculate_ma(kline:Candle):Promise<void>{
    await kline.mas?.forEach(ma=>{
        ma.values=sma({period:ma.period,values:kline.close_prices});
    })
}
async function calculate_macd(kline:Candle):Promise<void>{
    const _fastPeriod: number = kline.macd_periods[0];  // Период для быстрой EMA
    const _slowPeriod: number = kline.macd_periods[1];  // Период для медленной EMA
    const _signalPeriod: number = kline.macd_periods[2]; // Период для сигнальной линии
    const macdOut = await macd({
        values: kline.close_prices, fastPeriod: _fastPeriod, slowPeriod: _slowPeriod, signalPeriod: _signalPeriod,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    kline.macd=await macdOut.map(out=>{ return {_macd:out['MACD'],_histogram:out['histogram'],_signal:out['signal']}});
}
async function calculate_crsi(kline:Candle):Promise<void>{
     if(kline.rsi?.period){kline.rsi.values = await rsi({period:kline.rsi.period,values:kline.close_prices})};
}
async function calculate_BB(kline:Candle):Promise<void>{
    try{
        const bbOut=await bollingerbands({period:kline.bb_config!.period,stdDev:kline.bb_config!.dev,values:kline.close_prices});
        kline.bb =await bbOut.map(out=>{return{_middle: out["middle"],_upper:out["upper"],_lower: out["lower"]}}) 
    }
    catch (error) {
        console.error('Ошибка при вычислении лент Боллинджера:', error);
    }
    
}
async function get_kline_data(kline:Candle): Promise< [number[], string[]] >  {
    let historical_klines:any;
    const currentTimeInMilliseconds:number = new Date().getTime();
    historical_klines = await api_client.klineCandlestickData(current_pair, kline.interval,{ limit: kline.load_quantity,endTime:currentTimeInMilliseconds })
    const close_p:number[]=historical_klines.map((kline: any[]) => {return Number(kline[4])});
    const close_t:string[]=historical_klines.map((kline: number[]) => {return DateTime.fromMillis(kline[6]).toISO()});
    return [close_p,close_t];
}
export async function update_acc_balance(){
    try{
        const acc =  await api_client.accountInformation();
        let acc_info =acc.balances; 
        let cur_ass=acc_info.find(ass=>ass.asset==current_pair.slice(0,-4))!;
        global.current_balance = cur_ass==undefined?0:parseFloat(cur_ass.free);  
    }catch(e){
        console.log(e);
        global.current_balance= 0; 
    }
    
}
export const update_pair=(pair:string='TNSRUSDT')=>{global.current_pair=pair}
const get_interval=(intrvl:string):Interval=>{
    switch (intrvl){
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
}
export function get_kline(intervl:string){
    return klines.find(candle=>candle.interval===get_interval(intervl));
}
export const stop_websocket=()=>{
    clearInterval(btc_dom_int_id!);
    wsClient.closeAll(false);
}
export function processCandles(configuration:Candle_config[],curr_chat:string){
    klines=[]
    cid=curr_chat;
    update_pair();
    btc_dominance_state();
    configuration.forEach(config=>{
        const temp_candle:Candle={
            interval:get_interval(config.candleSize),
            load_quantity:config.quantity,
            close_prices:[],
            close_time:[],
            rsi:{period:config.rsiPeriod,values:[]},
            macd_periods:config.macdPeriods,
            mas:[],
            macd:[],
            bb_config:{period:config.BB_period!,dev:config.BB_dev!},
            bb:[]
        }
        config.movingAverages?.forEach(ma=>{
            temp_candle.mas?.push({period:ma,values:[]});
        })
        klines.push(temp_candle);
    })
    klines.forEach(kline => start_g_a(kline))
}
export async function updateMAS(per:number,iner:string){
    let curkl = get_kline(iner);
    if (curkl) {
        curkl.mas = curkl.mas || [];
        const newMA = { period: per, values: [] };
        curkl.mas.push(newMA);
        await calculate_ma(curkl);
    }
}
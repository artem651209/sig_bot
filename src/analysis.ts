import { Interval ,Spot,Side, OrderType, TimeInForce } from '@binance/connector-typescript';
import { WebsocketClient } from 'binance';
import { updateCharts,updateBalances } from './server.js';
import { rsi, sma ,macd, bollingerbands} from 'technicalindicators';
import {DateTime} from 'luxon';
import { Candle,cOrder,acc_Data, Candle_Config } from './contracts.js';
import {notify} from './tgbot.js';
import * as dotenv from 'dotenv';
dotenv.config({ path: 'out/config/.env' });

let b_api_key; 
let b_secret_key;
let api_client:Spot;
let candleWS:WebsocketClient;
let userWS:WebsocketClient;
const use_test=false;
if(use_test){
    b_api_key = process.env.B_TEST_KEY;
    b_secret_key= process.env.B_TEST_SEC_KEY;
    api_client=new Spot(b_api_key,b_secret_key,{baseURL:'https://testnet.binance.vision'});
    candleWS = new WebsocketClient({api_key: b_api_key,api_secret: b_secret_key,beautify:false,wsUrl:'wss://stream.testnet.binance.vision/ws'});
    userWS = new WebsocketClient({api_key: b_api_key,api_secret: b_secret_key,beautify:false,wsUrl:'wss://stream.testnet.binance.vision/ws'});
}else{
    b_api_key=process.env.B_API_KEY;
    b_secret_key=process.env.B_SEC_KEY;
    api_client=new Spot(b_api_key,b_secret_key);
    candleWS = new WebsocketClient({api_key: b_api_key,api_secret: b_secret_key,beautify:false});
    userWS = new WebsocketClient({api_key: b_api_key,api_secret: b_secret_key,beautify:false});
}

let cid:string;
let btc_dom_int_id;

let klines:Candle[]=[];
export const current_account:acc_Data={
    current_pair:'',
    base_curr:'',
    quote_curr:'',
    base_balance:0,
    quote_balance:0,
    prev_balance:0,
};
const user_LK=api_client.createListenKey();
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
const lastSignals: { [interv: string]: { macd: 'up' | 'down' | null, 
                                         rsi: 'up' | 'down' | null ,
                                         bb_x:'top'|'bot'|null,
                                         bb_ce:'-><-'|'<-->'|null } } = {};
async function signal_pattern(kline:Candle,interv:string){
    const macd_length=kline.macd.length;
    const cur_macd=kline.macd[macd_length-1];
    const prev_macd=kline.macd[macd_length-2];
    const rsi_length=kline.rsi.values.length;
    const cur_rsi=kline.rsi.values[rsi_length-1];
    const prev_rsi=kline.rsi.values[rsi_length-2];
    const prev_price=kline.close_prices[kline.close_prices.length-2];
    const cur_price=kline.close_prices[kline.close_prices.length-1];
    const cur_bb=kline.bb![kline.bb!.length-1];
    const prev_bb=kline.bb![kline.bb!.length-2];
    const bb_uppers=[cur_bb._upper!,prev_bb._upper!];
    const bb_lowers=[cur_bb._lower!,prev_bb._lower!];
    //\n MACD:${cur_macd} ${prev_macd}\n RSI:${cur_rsi} ${prev_price}\n PRICE:${cur_price} ${prev_price}`)
    const signals = {
        macd_up: prev_macd._macd! <= prev_macd._signal! && cur_macd._macd! > cur_macd._signal!,
        macd_down: prev_macd._macd! >= prev_macd._signal! && cur_macd._macd! < cur_macd._signal!,
        rsi_up: prev_rsi <= 30 && cur_rsi > 30,
        rsi_down: prev_rsi >= 70 && cur_rsi < 70,
        bb_x_top:cur_price>bb_uppers![0]&& prev_price<=bb_uppers![1],
        bb_x_bot:cur_price<bb_lowers![0] && prev_price>=bb_lowers![1],
        bb_contr:bb_uppers![1]-bb_lowers![1]>bb_uppers![0]-bb_lowers![0],
        bb_expan:bb_uppers![1]-bb_lowers![1]<bb_uppers![0]-bb_lowers![0]
    };
    const interval = interv;
    if (!lastSignals[interval]) {
        lastSignals[interval] = {
            macd: null,
            rsi: null,
            bb_x:null,
            bb_ce:null
        };
    }
    if(signals.bb_x_top){
        if(lastSignals[interval].bb_x!='top'){
            notify(cid, `На свече с интервалом ${interval} график цены пересёк ВЕРХНЮЮ ленту СНИЗУ ВВЕРХ.\n\nВОЗМОЖНО ПОРА ПРОДАВАТЬ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].bb_x = 'top';
        }
    }else if(signals.bb_x_bot){
        if(lastSignals[interval].bb_x!='bot'){
            notify(cid, `На свече с интервалом ${interval} график цены пересёк НИЖНЮЮ ленту СВЕРХУ ВНИЗ.\n\nВОЗМОЖНО ПОРА ПОКУПАТЬ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].bb_x = 'bot';
        }
    }
    if(signals.bb_contr){
        if(lastSignals[interval].bb_ce!='-><-'){
            notify(cid, `На свече с интервалом ${interval} ЛЕНТЫ начали СУЖАТЬСЯ.\n\nОЖИДАЕТСЯ СИЛЬНОЕ ДВИЖЕНИЕ ЦЕНЫ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].bb_ce = '-><-';
        }
    }else if(signals.bb_expan){
        if(lastSignals[interval].bb_ce!='<-->'){
            notify(cid, `На свече с интервалом ${interval} ЛЕНТЫ начали РАСХОДИТЬСЯ.\n\nСИЛЬНОЕ ДВИЖЕНИЕ ЦЕНЫ ПОДТВЕРЖДАЕТСЯ\nПроверить можешь на графике:\n <code>http://localhost:3000/${interval}</code>\n`);
            lastSignals[interval].bb_ce = '<-->';
        }
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
candleWS.on('message', async (data) => {
    if (!Array.isArray(data) && data.e === 'kline') {
      const ws_kline = data.k;
      const cur_kl = await klines.find(kline => kline.interval==ws_kline.i);
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
            if (!lastSignals[ws_kline.i]) {
                lastSignals[ws_kline.i] = {
                    macd: null,
                    rsi: null,
                    bb_x:null,
                    bb_ce:null
                };
            }
            move_flag=true;
        }else{
            cur_kl.close_prices[last_element]=clp;
        }
        await update_indicators(cur_kl);
        await signal_pattern(cur_kl,ws_kline.i);
        updateCharts(cur_kl,move_flag);
      }
    }
});
userWS.on('message',(data)=>{
    if (!Array.isArray(data) && data.e === 'executionReport') {
        if(data.X=='FILLED' && data.o=='LIMIT'){
            const ex_p=typeof(data.p)=="string"?parseFloat(data.p):data.p;
            const ex_q=typeof(data.q)=="string"?parseFloat(data.q):data.q;
            const tot=ex_p * ex_q;
            const mess=`Лимитный ордер на ${data.S} был исполнен:\n
                        Исполненное количество: ${data.I}\n
                        Цена исполнения: ${data.p}\n
                        Общая цена: ${tot}`
            notify(cid,mess);
        }else if(data.X!='PARTIALLY_FILLED' && data.o=='LIMIT' && data.X!='FILLED'){
            const mess=`Лимитный ордер на ${data.S} не был исполнен:\n
                        Установлення цена исполнения: ${data.p}\n
                        Код ошибки: ${data.X}`
            notify(cid,mess);
        }
    }
})
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
    candleWS.subscribeSpotKline(current_account.current_pair,current_candle.interval);
    userWS.subscribeSpotUserDataStreamWithListenKey((await user_LK).listenKey,false);
}
async function calculate_ma(kline:Candle):Promise<void>{
    await kline.mas?.forEach(ma=>{
        ma.values=sma({period:ma.period,values:kline.close_prices});
    })
}
async function calculate_macd(kline:Candle):Promise<void>{
    const _fastPeriod: number = kline.macd_periods[0];  
    const _slowPeriod: number = kline.macd_periods[1]; 
    const _signalPeriod: number = kline.macd_periods[2]; 
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
    try {
        if (kline.close_prices.length >= kline.bb_config!.period) {
            const bbOut = bollingerbands({ period: kline.bb_config!.period, stdDev: kline.bb_config!.dev, values: kline.close_prices });
            kline.bb = bbOut.map(out => {
                return { _middle: out["middle"], _upper: out["upper"], _lower: out["lower"] };
            });
        } else {
            console.error("Insufficient data for Bollinger Bands calculation");
        }
    } catch (error) {
        console.error("Error calculating Bollinger Bands:", error);
    }
}
async function get_kline_data(kline:Candle): Promise< [number[], string[]] >  {
    let historical_klines:any;
    historical_klines = await api_client.klineCandlestickData(current_account.current_pair, kline.interval,{ limit: kline.load_quantity,endTime: new Date().getTime() })
    const close_p:number[]=historical_klines.map((kline: any[]) => {return Number(kline[4])});
    const close_t:string[]=historical_klines.map((kline: number[]) => {return DateTime.fromMillis(kline[6]).toISO()});
    return [close_p,close_t];
}
export async function update_pair(pair:string){
    current_account.current_pair=pair;
}
export async function upd_acc_info(start:boolean):Promise<void>{
    try {
        const acc = await api_client.accountInformation({ recvWindow: 10000 });
        let acc_info = acc.balances;
        if (start) {
            let base_ass = acc_info.find(ass => ass.asset === current_account.current_pair.slice(0, -4));
            if(base_ass){
                current_account.base_curr= current_account.current_pair.slice(0, -4);
                current_account.base_balance=parseFloat(base_ass.free);
            }else{
                base_ass=acc_info.find(ass=>ass.asset === current_account.current_pair.slice(0, -3))
                if(base_ass){current_account.base_curr=current_account.current_pair.slice(0, -3);
                current_account.base_balance=parseFloat(base_ass.free);}
            }
            let quote_ass=acc_info.find(ass => ass.asset === current_account.current_pair.slice(-4));
            if(quote_ass){
                current_account.quote_curr= current_account.current_pair.slice(-4);
                current_account.quote_balance=parseFloat(quote_ass.free);
            }else{
                quote_ass=acc_info.find(ass=>ass.asset === current_account.current_pair.slice(-3))
                if(quote_ass){current_account.quote_curr=current_account.current_pair.slice(-3);
                current_account.quote_balance=parseFloat(quote_ass.free);}
            }
            current_account.prev_balance = current_account.base_balance;
            console.log(current_account)
        }else{
            let base_ass = acc_info.find(ass => ass.asset === current_account.base_curr);
            let quote_ass=acc_info.find(ass => ass.asset === current_account.quote_curr);
            current_account.base_balance=parseFloat(base_ass!.free);
            current_account.quote_balance=parseFloat(quote_ass!.free);
        }
    } catch (e) {
        console.log(e);
        current_account.base_balance = 0;
    }
}
export async function placeUserOrder(cur_order:cOrder){
    try{
        const action:Side=cur_order.action=="BUY"?Side.BUY:Side.SELL;
        if(cur_order.type=="limit"){
            await api_client.newOrder(current_account.current_pair,action,OrderType.LIMIT,{timeInForce:TimeInForce.GTC,price:cur_order.price,quantity:cur_order.quantity,recvWindow:10000})
            await upd_acc_info(false)
            updateBalances(current_account)
            notify(cid,`Был выставлен лимитный ордер на ${cur_order.action}:\n Цена исполнения:${cur_order.price}\n Количество токенов ${current_account.base_curr}:${cur_order.quantity}\n Общая стомоимость ${current_account.quote_curr}:${cur_order.total}`)
        }else{
            await api_client.newOrder(current_account.current_pair,action,OrderType.MARKET,{quantity:cur_order.quantity,recvWindow:10000})
            await upd_acc_info(false)
            updateBalances(current_account)
            notify(cid,`Был исполнен рыночный ордер на ${cur_order.action}:\n Цена исполнения:${cur_order.price}\n Количество токенов ${current_account.base_curr}:${cur_order.quantity}\n Общая стомоимость ${current_account.quote_curr}:${cur_order.total}`)
        } 
    }catch(e){
        console.log(e)
    }
}
export function get_statistics(){
    upd_acc_info(false);
    const diff =current_account.base_balance - current_account.prev_balance
    const pdiff=(diff/current_account.prev_balance)*100;
    return `До запуска баланс выбранной монет составлял: ${current_account.prev_balance}\n Cейчас он составляет: ${current_account.base_balance}\n Разница: ${pdiff.toFixed(2)}%`
}
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
export function get_account(){
    return current_account;
}
export const stop_websocket=()=>{
    clearInterval(btc_dom_int_id!);
    candleWS.closeAll(false);
}
export function processCandles(configuration:Candle_Config[],pair:string,curr_chat:string){
    klines=[]
    cid=curr_chat;
    upd_acc_info(true);
    btc_dominance_state();
    current_account.current_pair=pair;
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
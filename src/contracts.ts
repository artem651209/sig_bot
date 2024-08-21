import { Interval } from "@binance/connector-typescript";
interface FibonacciLevels{
    '0%':number;
    '23.6%':number;
    '38.2%':number;
    '50%':number;
    '61.8%':number;
    '100%':number;
}
interface MovingAverageConvergenceDivergence{
    _macd:number|undefined;
    _signal:number|undefined;
    _histogram:number|undefined;
}
interface BollBands{
    _middle: number;
    _upper: number;
    _lower: number;
}
interface Candle{
    interval:Interval;
    load_quantity:number;
    close_time:string[];
    fibonacci_levels?:FibonacciLevels;
    macd_periods:number[];
    macd:MovingAverageConvergenceDivergence[];
    close_prices:number[];
    mas?:{period:number,values:number[]}[];
    rsi:{period?:number,values:number[]};
    bb_config?:{period:number,dev:number};
    bb?:BollBands[];
}
interface cOrder{
    action:string,
    type:string,
    price:number|undefined,
    quantity:number,
    total:number
}
interface acc_Data{
    current_pair:string;
    base_curr:string;
    quote_curr:string;
    base_balance:number;
    quote_balance:number;
    prev_balance:number;
    minnot:number
}
interface Candle_Config {
    candleSize: string;
    quantity: number;
    movingAverages?: number[];
    macdPeriods: number[]; // short long signal
    rsiPeriod?: number;
    BB_period?:number;
    BB_dev?:number
}

interface Bot_Config {
    [chatId: string]:{
        pair:string;
        cc:Candle_Config[];
    }
}
export{Candle_Config,Bot_Config,acc_Data,Candle,cOrder,BollBands,MovingAverageConvergenceDivergence}
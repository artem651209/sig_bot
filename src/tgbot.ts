import TelegramBot from 'node-telegram-bot-api';
import * as fs from 'fs';
import { upd_acc_info, processCandles, stop_websocket, get_statistics,current_account ,update_pair} from './analysis.js';
import {Candle_Config, Bot_Config} from  './contracts.js'
import * as path from 'path';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

dotenv.config({ path: 'out/config/.env' });
const token = process.env.VISNU_TOKEN!;
const bot: TelegramBot = new TelegramBot(token, { polling: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configDir = path.join(__dirname, 'config');
const configPath = path.join(configDir, 'bot-config.json');

const config_path: string = path.join(__dirname, 'config', 'bot-config.json');
let temp_candle_config: Candle_Config = { candleSize: '1m', quantity: 100, macdPeriods: [12, 26, 9] };
interface ChatMessageIds {
    [chatId: string]: number[];
}

let chatMessageIds: ChatMessageIds = {};
const edit_window = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: 'Кол-во выгружаемых свеч', callback_data: 'edit_kline_quantity' }
            ],
            [
                { text: 'MA', callback_data: 'edit_MA' },
                { text: 'RSI', callback_data: 'edit_RSI' },
                { text: 'MACD', callback_data: 'edit_MACD' },
                { text: 'BB',callback_data: 'edit_BB'}
            ],
            [
                { text: 'Сохранить', callback_data: 'save_candle_config' }
            ],
            [
                { text: 'Назад', callback_data: 'back_to_candle_choice' }
            ]
        ]
    }
};

const start_choice_window = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: 'СТАТИСТИКА(пока не выбирай)', callback_data: 'bot_statistics' }
            ],
            [
                { text: 'Выбор пары', callback_data: 'pair_selection' },
                { text: 'Настройки', callback_data: 'settings' }
            ],
            [
                { text: 'Конфигурация', callback_data: 'check_config' }
            ],
            [
                { text: 'ЗАПУСК!!!!', callback_data: 'start' }
            ]
        ]
    }
};

const candle_choice_window = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '1 минута', callback_data: '1m' },
                { text: '15 минут', callback_data: '15m' }
            ],
            [
                { text: '1 час', callback_data: '1h' },
                { text: '1 день', callback_data: '1d' }
            ],
            [
                { text: 'сохранить конфигурацию', callback_data: 'save_bot_config' }
            ],
            [
                { text: 'Назад', callback_data: 'back_to_start_choice' }
            ]
        ]
    }
};

const chatState: { [chatId: string]: string } = {};
const previousWindows: { [chatId: string]: string } = {};

const save_candle = (chat_id: string) => {
    const candle_index = current_config[chat_id].cc.findIndex(candle => candle.candleSize == temp_candle_config.candleSize);
    if (candle_index >= 0) {
        current_config[chat_id].cc[candle_index] = temp_candle_config;
    } else {
        current_config[chat_id].cc.push(temp_candle_config);
    }
};

const saveConfig = () => {
    fs.writeFileSync(configPath, JSON.stringify(current_config, null, 2));
};

function notify_atem(text:string){
    bot.sendMessage("304470538",text)
}

function check_config_completion(chat_id: string): number {
    return current_config[chat_id].cc.length;
}

const askQuestion = (chatId: string, question: string, state: string) => {
    bot.sendMessage(chatId, question);
    chatState[chatId] = state;
};

const loadConfig = (): Bot_Config => {
    if (fs.existsSync(configPath)) {
        const fileContents = fs.readFileSync(configPath, 'utf-8');
        return fileContents ? JSON.parse(fileContents) : {};
    }
    return {};
};

export let current_config = loadConfig();
console.log(current_config)
bot.onText(/\/start/,async  (msg) => {
    const chatId = msg.chat.id.toString();
    notify_atem(`прошлая комманда старт у ${chatId}`);
    await update_pair(current_config[chatId].pair);
    await upd_acc_info(true);
    bot.sendMessage(chatId, 'Привет! Я бот, который анализирует графики и индикаторы на Binance.').then(() => {
        return bot.sendMessage(chatId, `Текущая пара: ${current_config[chatId].pair}`);
    }).then(() => {
        bot.sendMessage(chatId, `Текущий баланс: ${current_account.base_balance}`);
    }).then(() => {
        if (!current_config[chatId].cc || current_config[chatId].cc.length === 0) {
            return bot.sendMessage(chatId, 'Бот не настроен, перейди в настройки чтобы создать конфигурацию', start_choice_window);
        } else {
            let mess='\n';
            current_config[chatId].cc.forEach(conf=>{
                mess+=`Интервал выгружаемой свечи: ${conf.candleSize}\n
                    Количество выгружаемых свечей: ${conf.quantity}\n
                    MA на графике имеют интервалы: ${conf.movingAverages}\n
                    Периоды MACD: ${conf.macdPeriods}\n
                    Период RSI: ${conf.rsiPeriod}\n
                    Конфигурация лент: Период ${conf.BB_period}, Стад. откл. ${conf.BB_dev}\n`;
            })
            return bot.sendMessage(chatId, `Бот настроен, вот текущая конфигурация:\n 
            ${mess}если хочешь что-то изменить, перейди в настройки`, start_choice_window);
        }
    })
});

export function notify(cid: string, mess: string): void {
    bot.sendMessage(cid, mess, { parse_mode: "HTML" }).then((sentMessage) => {
        if (!chatMessageIds[cid]) {
            chatMessageIds[cid] = [];
        }
        chatMessageIds[cid].push(sentMessage.message_id)});
}

bot.on('callback_query', (callbackQuery) => {
    const message: TelegramBot.Message | undefined = callbackQuery.message;
    const chatId = callbackQuery.message?.chat.id.toString();
    const messageId = callbackQuery.message?.message_id;
    const data: string | undefined = callbackQuery.data;
    if (!chatId || !messageId) return;

    switch (data) {
        case 'pair_selection':
            askQuestion(chatId, 'Выберите пару...', data);
            break;

        case 'bot_statistics':
            bot.sendMessage(chatId, 'Вы выбрали команду: К боту');
            break;

        case 'settings':
            if (!current_config[chatId].cc || current_config[chatId].cc.length === 0) {
                previousWindows[chatId] = 'start_choice_window';
                bot.editMessageText('Давай создадим конфигурацию, выбери вид свечи', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: candle_choice_window.reply_markup
                });
            } else {
                previousWindows[chatId] = 'start_choice_window';
                bot.editMessageText('Бот настроен, но если хочешь что-то изменить, прошу', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: candle_choice_window.reply_markup
                });
            }
            break;

        case 'edit_kline_quantity':
            askQuestion(chatId, 'Отправь количество свечей для отображения', data);
            break;

        case 'edit_MA':
            askQuestion(chatId, 'Отправь периоды скользящих средних через пробел (небольшое напоминание, период должен быть меньше количества отображаемых свечей)', data);
            break;

        case 'edit_RSI':
            askQuestion(chatId, 'Отправь период для расчета RSI', data);
            break;

        case 'edit_MACD':
            askQuestion(chatId, 'Отправь периоды линий MACD в таком порядке: Период для быстрой EMA, Период для медленной EMA, Период для сигнальной линии. Пример: 12 26 9', data);
            break;
        case 'edit_BB':
            askQuestion(chatId, 'Отправь Период лент Боллинджера и Стандартное отклонение. Пример: 20 2', data);
            break;
        case "1m":
        case "15m":
        case "1h":
        case "1d":
            current_config = loadConfig();
            const candle_found = current_config[chatId].cc.find(candle => candle.candleSize === data);
            if (candle_found) {
                temp_candle_config = candle_found;
            } else {
                temp_candle_config = { candleSize: data, quantity: 100, macdPeriods: [12, 26, 9] };
            }
            previousWindows[chatId] = 'candle_choice_window';
            bot.editMessageText(`Сейчас редактируем свечу типа ${data}. Что устанавливаем?`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: edit_window.reply_markup
            });
            break;

        case 'save_candle_config':
            save_candle(chatId);
            const saved_candle_type: string | undefined = temp_candle_config.candleSize;
            bot.editMessageText(`Успешно сохранена свеча типа ${saved_candle_type}. Если хочешь, можешь добавить ещё свечи, выбирай, или жми сохранить конфигурацию и запускай бота!`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: candle_choice_window.reply_markup
            });
            break;

        case 'save_bot_config':
            if (check_config_completion(chatId) > 0) {
                saveConfig();
                bot.editMessageText('Конфигурация сохранена', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: start_choice_window.reply_markup
                });
            } else {
                bot.editMessageText('Добавь хотя бы одну свечу!!!!', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: candle_choice_window.reply_markup
                });
            }
            break;

        case 'check_config':
            let mess='\n';
            current_config=loadConfig();
            current_config[chatId].cc.forEach(conf=>{
                mess+=`Интервал выгружаемой свечи: ${conf.candleSize}\n
                       Количество выгружаемых свечей: ${conf.quantity}\n
                       MA на графике имеют интервалы: ${conf.movingAverages}\n
                       Периоды MACD: ${conf.macdPeriods}\n
                       Период RSI: ${conf.rsiPeriod}\n
                       Конфигурация лент: Период ${conf.BB_period}, Стад. откл. ${conf.BB_dev}\n`;
            })
            bot.sendMessage(chatId, `Текущая конфигурация:\n 
            ${mess}если хочешь что-то изменить, перейди в настройки`, start_choice_window);
            break

        case 'back_to_start_choice':
            bot.editMessageText('начальника, приказывайте', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: start_choice_window.reply_markup
            });
            break;

        case 'back_to_candle_choice':
            bot.editMessageText('Выбери вид свечи', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: candle_choice_window.reply_markup
            });
            break;

        case 'start':
            current_config = loadConfig();
            notify_atem("бот был запущен");
            processCandles(current_config[chatId].cc, current_config[chatId].pair,chatId);
            bot.editMessageText(
                `Переходи по ссылочке чтобы графики открылись:\n<code>http://localhost:3000/1m</code>\n
                Это самая базовая ссылочка, если хочешь открыть другой вид свечи замени (1m) на нужный интервал (главное чтобы он был в конфигурации).\n
                Можно открывать одновременно несколько, есличо`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'ОСТАНОВИТЬ!!!', callback_data: 'stop' }]
                        ]
                    }
                });
            break;

        case 'stop':
            stop_websocket();
            if (chatMessageIds[chatId]) {
                chatMessageIds[chatId].forEach((msgId) => {
                    bot.deleteMessage(chatId, msgId).catch((error) => {
                        console.error(`Failed to delete message ${msgId}: `, error);
                    });
                });
                chatMessageIds[chatId] = [];
            }
            let stat_message = get_statistics();
            notify_atem(`Бот был остановлен \n ${stat_message}`);
            bot.editMessageText(`Подключение к бирже остановлено, можешь свободно корректировать конфигурацию и перезапускать.\n Данные о сессии\n${stat_message}`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: start_choice_window.reply_markup
            });
            break;
    }
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id.toString();
    const text = msg.text || '';
    if (!chatState[chatId]) return;

    switch (chatState[chatId]) {
        case 'pair_selection':
            current_config[chatId].pair=text;
            bot.sendMessage(chatId, `Пара обновлена на ${text}`);
            saveConfig();
            break;

        case 'edit_kline_quantity':
            try {
                temp_candle_config.quantity = parseInt(text);
                bot.sendMessage(chatId, `Количество выгружаемых свечей = ${temp_candle_config.quantity}. Редактируем дальше?`, edit_window);
            } catch (e) {
                bot.sendMessage(chatId, `Что-то пошло не так, попробуй отправить ещё раз, тупо цифру`);
            }
            break;

        case 'edit_MA':
            try {
                temp_candle_config.movingAverages = text.split(' ').map(Number);
                bot.sendMessage(chatId, `Периоды скользящих средних: ${temp_candle_config.movingAverages.join(', ')}. Редактируем дальше?`, edit_window);
            } catch (e) {
                bot.sendMessage(chatId, `Что-то пошло не так, попробуй отправить ещё раз, тупо цифры через пробел`);
            }
            break;

        case 'edit_RSI':
            try {
                temp_candle_config.rsiPeriod = parseInt(text);
                bot.sendMessage(chatId, `Период RSI = ${temp_candle_config.rsiPeriod}. Редактируем дальше?`, edit_window);
            } catch (e) {
                bot.sendMessage(chatId, `Что-то пошло не так, попробуй отправить ещё раз, тупо цифру`);
            }
            break;

        case 'edit_MACD':
            try {
                temp_candle_config.macdPeriods = text.split(' ').map(Number);
                bot.sendMessage(chatId, `Периоды MACD: Быстрая EMA = ${temp_candle_config.macdPeriods[0]}, Медленная EMA = ${temp_candle_config.macdPeriods[1]}, Сигнальная линия = ${temp_candle_config.macdPeriods[2]}. Редактируем дальше?`, edit_window);
            } catch (e) {
                bot.sendMessage(chatId, `Что-то пошло не так, попробуй отправить ещё раз, тупо цифры через пробел`);
            }
            break;
        case 'edit_BB':
            try {
                const bb_arr = text.split(' ').map(Number);
                temp_candle_config.BB_period=bb_arr[0];
                temp_candle_config.BB_dev=bb_arr[1];
                bot.sendMessage(chatId, `Период лент: ${temp_candle_config.BB_period}, Стандартное отклонение лент: ${temp_candle_config.BB_dev}. Редактируем дальше?`, edit_window);
            } catch (e) {
                bot.sendMessage(chatId, `Что-то пошло не так, попробуй отправить ещё раз, тупо цифры через пробел`);
            }
        
    }
});

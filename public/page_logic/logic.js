let candleData;
let cur_price;
let acc_data;
let fibonacciLevels = [];
const maColors = JSON.parse(localStorage.getItem('maColors')) || {};
let closePriceColor = localStorage.getItem('closePriceColor') || "#ffffff";
let selectedRange = null;
const interval = window.location.pathname.split('/')[1];
const socket = io({ query: { interval } });
let startIdx = null;
let endIdx = null;
let wasDrawn = false;
let fib_candle_data = null;
let predictionData = null;
let predictionTraceIndex = null;
let order={action:'BUY',type:'limit',price:-1,quantity:-1,total:-1}
const maWeights = JSON.parse(localStorage.getItem('maWeights')) || {};
document.getElementById('addMAButton').addEventListener('click', () => {
    const newMAPeriod = parseInt(document.getElementById('newMAPeriod').value);
    if (isNaN(newMAPeriod) || newMAPeriod < 1) {
        alert('Please enter a valid period.');
        return;
    }
    maColors[newMAPeriod] = '#add8e6';
    localStorage.setItem('maColors', JSON.stringify(maColors));
    socket.emit('addMA', { period: newMAPeriod, interval: interval });
    location.reload();
});
document.getElementById('colorPicker-close').value = closePriceColor;
document.getElementById('colorPicker-close').addEventListener('change', (event) => {
    closePriceColor = event.target.value;
    localStorage.setItem('closePriceColor', closePriceColor);
    if (candleData) updateChart(candleData);
});
document.getElementById("execute").addEventListener('click',()=>{
    socket.emit('palceOrder',order)
})
document.getElementById('predict').addEventListener('change', updatePrediction);
document.getElementById('clearFibonacci').addEventListener('click', () => {
    let order = 10;
    if (predictionData) { order += 1; }
    Plotly.deleteTraces('chart', fibonacciLevels.map((_, i) => candleData.mas.length + order + i));
    fibonacciLevels = [];
    wasDrawn = false;
    startIdx = null;
    endIdx = null;
    fib_candle_data = null;
});
document.getElementById('percentageSlider-l').addEventListener('input', function() {
    document.getElementById('limit-sliderValue').innerText = this.value + '%';
});
document.getElementById('percentageSlider-m').addEventListener('input', function() {
    document.getElementById('market-sliderValue').innerText = this.value + '%';
});
document.addEventListener('DOMContentLoaded', function() {
    const limitAmountInput = document.getElementById('limit-amount');
    const limitTotalInput = document.getElementById('limit-total');
    const limitSlider = document.getElementById('percentageSlider-l');
    const limitSliderValue = document.getElementById('limit-sliderValue');
    const marketAmountInput = document.getElementById('market-amount');
    const marketTotalInput = document.getElementById('market-total');
    const marketSlider = document.getElementById('percentageSlider-m');
    const marketSliderValue = document.getElementById('market-sliderValue');
    const side_state = document.getElementById('BSswitch')
    side_state.addEventListener('change',()=>{
        order.action=side_state.checked?'SELL':'BUY'
        console.log(order.action)
    })
    limitAmountInput.addEventListener('input', function() {
        updateFieldsFromAmount(limitAmountInput, limitTotalInput, limitSlider, limitSliderValue,side_state.checked,0);
    });
    limitTotalInput.addEventListener('input', function() {
        updateFieldsFromTotal(limitAmountInput, limitTotalInput, limitSlider, limitSliderValue,side_state.checked,0);
    });
    limitSlider.addEventListener('input', function() {
        updateFieldsFromSlider(limitAmountInput, limitTotalInput, limitSlider, limitSliderValue,side_state.checked,0);
    });
    marketAmountInput.addEventListener('input', function() {
        updateFieldsFromAmount(marketAmountInput, marketTotalInput, marketSlider, marketSliderValue,side_state.checked);
    });
    marketTotalInput.addEventListener('input', function() {
        updateFieldsFromTotal(marketAmountInput, marketTotalInput, marketSlider, marketSliderValue,side_state.checked);
    });
    marketSlider.addEventListener('input', function() {
        updateFieldsFromSlider(marketAmountInput, marketTotalInput, marketSlider, marketSliderValue,side_state.checked);
    });
});
socket.on('showInitialData', (initialData,acc) => {
    if (initialData.interval == interval) {
        candleData = initialData;
        acc_data=acc;
        document.getElementById('tradingPair').textContent=acc_data.current_pair;
        document.getElementById('base_a').textContent=`${acc_data.base_curr} : ${acc_data.base_balance}`
        document.getElementById('quote_a').textContent=`${acc_data.quote_curr} : ${acc_data.quote_balance}`
        document.getElementById('lt').textContent=`Total in ${acc_data.quote_curr}`
        document.getElementById('mt').textContent=`Total in ${acc_data.quote_curr}`
        document.getElementById('la').textContent=`Amount in ${acc_data.base_curr}`
        document.getElementById('ma').textContent=`Amount in ${acc_data.base_curr}`
        cur_price=candleData.close_prices[candleData.close_prices.length-1]
        document.getElementById('market-price').textContent=`Current price : ${candleData.close_prices[candleData.close_prices.length-1]}`
        setupMAControls(initialData.mas);
        initializeChart(initialData);
    }
});
socket.on('update', (candle, moved) => {
    if (candle.interval == interval) {
        candleData = candle;
        cur_price=candleData.close_prices[candleData.close_prices.length-1]
        document.getElementById('market-price').textContent=`Current price : ${candleData.close_prices[candleData.close_prices.length-1]}`
        updateChart(candleData);
    }
});
socket.on('upd_acc',(acc)=>{
    acc_data=acc
    document.getElementById('base_a').textContent=`${acc_data.base_curr} : ${acc_data.base_balance}`
    document.getElementById('quote_a').textContent=`${acc_data.quote_curr} : ${acc_data.quote_balance}`
});
function updateFieldsFromAmount(amountInput, totalInput, slider, sliderValue,b_s,order_type=1) {
    const p=order_type==1?cur_price:document.getElementById('limit-price').value;
    const amount = amountInput.value;
    const total = amount * p; 
    const using_balance = b_s?acc_data.base_balance:acc_data.quote_balance;
    const using_asset = b_s?amount:total;
    slider.value = (amount / using_balance * 100).toFixed(0); 
    sliderValue.textContent = `${slider.value}%`;
    totalInput.value = total.toFixed(2);
    order.quantity=amount;
    order.price=p;
    order.total=total;
}
function updateFieldsFromTotal(amountInput, totalInput, slider, sliderValue,b_s,order_type=1) {
    const p=order_type==1?cur_price:document.getElementById('limit-price').value;
    const total = totalInput.value;
    const amount = total / p;
    amountInput.value = amount.toFixed(4);
    const using_balance = b_s?acc_data.base_balance:acc_data.quote_balance
    const using_asset = b_s?amount:total;
    slider.value = (amount / using_balance * 100).toFixed(0);
    sliderValue.textContent = `${slider.value}%`;
    order.quantity=amount;
    order.price=p;
    order.total=total;
}
function updateFieldsFromSlider(amountInput, totalInput, slider, sliderValue,b_s,order_type=1) {
    const p=order_type==1?cur_price:document.getElementById('limit-price').value;
    const percentage = slider.value;
    if(b_s){
        const amount  = (percentage / 100)*acc_data.base_balance;
        amountInput.value = amount.toFixed(4);
        const total = amount * p;
        totalInput.value = total.toFixed(2);
        order.quantity=amount;
        order.price=p;
        order.total=total;
    }else{
        const total = (percentage / 100)*acc_data.quote_balance;
        totalInput.value = total.toFixed(2);
        const amount = total * p;
        amountInput.value = amount.toFixed(4);
        order.quantity=amount;
        order.price=p;
        order.total=total;
    }
    sliderValue.textContent = `${percentage}%`;
}
function showSection(sectionId) {
    const sections = document.querySelectorAll('.section');
    const tabs = document.querySelectorAll('.tab');

    sections.forEach(section => {
        section.classList.remove('active');
    });

    tabs.forEach(tab => {
        tab.classList.remove('active');
    });

    document.getElementById(sectionId).classList.add('active');
    document.querySelector(`.tab[onclick="showSection('${sectionId}')"]`).classList.add('active');
    order.type=sectionId;
}
function setupMAControls(mas) {
    const maControls = document.getElementById('maControls');
    maControls.innerHTML = '';   
    mas.forEach(ma => {
        const color = maColors[ma.period] || '#add8e6';
        const maDiv = document.createElement('div');
        maDiv.className = 'color-picker';
        maDiv.innerHTML = `
            <label for="colorPicker-${ma.period}">SMA (${ma.period}) Color:</label>
            <input type="color" id="colorPicker-${ma.period}" value="${color}">
            <label for="weightInput-${ma.period}">Weight:</label>
            <input type="number" id="weightInput-${ma.period}" value="${maWeights[ma.period] || 1}" min="0" step="0.1">
        `;
        maDiv.querySelector('input[type="color"]').addEventListener('change', (event) => {
            maColors[ma.period] = event.target.value;
            localStorage.setItem('maColors', JSON.stringify(maColors));
            if (candleData) updateChart(candleData);
        });
        maDiv.querySelector('input[type="number"]').addEventListener('change', (event) => {
            maWeights[ma.period] = parseFloat(event.target.value);
            localStorage.setItem('maWeights', JSON.stringify(maWeights));
        });
        maControls.appendChild(maDiv);
    });
}
function predictNextPrice(mas) {
    const latestData = mas.map(ma =>{ 
        return { period:ma.period, last_value:ma.values[ma.values.length-1]}
    })
    let weightedSmaSum = 0;
    let totalWeight = 0;

    for (const [key, weight] of Object.entries(maWeights)) {
        const cur_ma=latestData.find(ma=>ma.period===parseInt(key))
        if (cur_ma) {
            weightedSmaSum += cur_ma.last_value * weight;
            totalWeight += weight;
        }
    }
    const last_price=candleData.close_prices[candleData.close_prices.length-1]
    const weightedSmaAverage = weightedSmaSum / totalWeight;
    const nextPrice = last_price + (last_price - weightedSmaAverage);
    return nextPrice;
}
function updatePrediction() {
    if (!candleData || !candleData.close_prices || candleData.close_prices.length === 0) return;
    if (predictionData){
        
        Plotly.deleteTraces('chart', candleData.mas.length+10);
        predictionData=null;
    }
    if(document.getElementById('predict').checked){
        const nextPrice = predictNextPrice(candleData.mas);
        const lastDateTime = luxon.DateTime.fromISO(candleData.close_time[candleData.close_time.length - 1]);
        const secondLastDateTime = luxon.DateTime.fromISO(candleData.close_time[candleData.close_time.length - 2]);
        const timeDifference = lastDateTime.diff(secondLastDateTime).milliseconds;
        predictionData = {
            x: [candleData.close_time[candleData.close_time.length - 1], lastDateTime.plus({ milliseconds: timeDifference }).toISO()],
            y: [candleData.close_prices[candleData.close_prices.length - 1], nextPrice],
            line: { color: 'yellow', dash: 'dot' },
            name: 'Predicted Price'
        };
        Plotly.addTraces('chart', {
            x: predictionData.x,
            y: predictionData.y,
            type: 'scatter',
            mode: 'lines+markers',
            line: predictionData.line,
            name: predictionData.name
        });
    }
}
function initializeChart(candle) {
    const data = getChartData(candle);
    const layout = {
        title: 'Real-time Chart',
        yaxis: { title: 'Price', color: 'white', domain: [0.5, 1.0], anchor: 'x' },
        yaxis2: { title: 'RSI Value', color: 'white', domain: [0.3, 0.5], anchor: 'x2' },
        yaxis3: { title: 'MACD', color: 'white', domain: [0.0, 0.3], anchor: 'x3' },
        xaxis: { domain: [0, 1], anchor: 'y' },
        xaxis2: { domain: [0, 1], anchor: 'y2' },
        xaxis3: { domain: [0, 1], anchor: 'y3' },
        paper_bgcolor: '#2b2b2b',
        plot_bgcolor: '#2b2b2b',
        font: { color: 'white' },
        showlegend: true,
        grid: { rows: 3, columns: 1, pattern: 'independent' },
        dragmode: 'box'
    };

    Plotly.newPlot('chart', data, layout, {scrollZoom: true});
}
function getChartData(candle) {
    const data = [];

    data.push({
        x: candle.close_time,
        y: candle.close_prices,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Close Prices',
        line: { color: closePriceColor },
        xaxis: 'x',
        yaxis: 'y'
    });

    if (candle.mas) {
        candle.mas.forEach(ma => {
            const color = maColors[ma.period] || 'lightblue';
            data.push({
                x: candle.close_time.slice(ma.period),
                y: ma.values,
                type: 'scatter',
                mode: 'lines',
                name: `SMA (${ma.period})`,
                line: { color: color },
                xaxis: 'x',
                yaxis: 'y'
            });
        });
    }
    if (candle.bb){
        const bbupper=candle.bb.map(item=>item._upper);
        const bbmiddle=candle.bb.map(item=>item._middle);
        const bblower=candle.bb.map(item=>item._lower);
        data.push({
            x: candle.close_time.slice(candle.bb_config.period),
            y: bbupper,
            type: 'scatter',
            mode: 'lines',
            name: 'UpperBB',
            line: { color: 'red' ,dash:'dot'},
            xaxis: 'x',
            yaxis: 'y'
        });
        data.push({
            x: candle.close_time.slice(candle.bb_config.period),
            y:  bbmiddle,
            type: 'scatter',
            mode: 'lines',
            name: 'MiddleBB',
            line: { color: 'red',dash:'dot' },
            xaxis: 'x',
            yaxis: 'y'
        });
        data.push({
            x: candle.close_time.slice(candle.bb_config.period),
            y: bblower,
            type: 'scatter',
            mode: 'lines',
            name: 'LowerBB',
            line: { color: 'red',dash:'dot' },
            xaxis: 'x',
            yaxis: 'y'
        });
    }
    if (candle.rsi) {
        const rsiValues = candle.rsi.values;
        const time_axis = candle.close_time.slice(candle.rsi.period);
        data.push({
            x: time_axis,
            y: rsiValues,
            type: 'scatter',
            mode: 'lines',
            name: 'RSI',
            line: { color: '#7C4DFF' },
            xaxis: 'x2',
            yaxis: 'y2'
        });

        data.push({
            x: [time_axis[0], time_axis[time_axis.length - 1]],
            y: [70, 70],
            type: 'scatter',
            mode: 'lines',
            name: 'Overbought (70)',
            line: { color: 'red', dash: 'dash' },
            xaxis: 'x2',
            yaxis: 'y2'
        });

        data.push({
            x: [time_axis[0], time_axis[time_axis.length - 1]],
            y: [30, 30],
            type: 'scatter',
            mode: 'lines',
            name: 'Oversold (30)',
            line: { color: 'green', dash: 'dash' },
            xaxis: 'x2',
            yaxis: 'y2'
        });
    }

    if (candle.macd) {
        const macdValues = candle.macd.map(item => item._macd);
        let signalValues = candle.macd.map(item => item._signal);
        let histogramValues = candle.macd.map(item => item._histogram);
        histogramValues = histogramValues.filter(item => item !== undefined);
        signalValues = signalValues.filter(item => item !== undefined);
        const macdTimes = candle.close_time.slice(candle.macd_periods[1] - 1);
        const signalTimes = candle.close_time.slice(candle.macd_periods[1] - 1 + candle.macd_periods[2]);
        const histogramColors = histogramValues.map(value => value >= 0 ? 'rgba(0, 255, 0, 0.5)' : 'rgba(255, 0, 0, 0.5)');

        data.push({
            x: macdTimes,
            y: macdValues,
            type: 'scatter',
            mode: 'lines',
            name: 'MACD',
            line: { color: '#3179f5' },
            xaxis: 'x3',
            yaxis: 'y3'
        });

        data.push({
            x: signalTimes,
            y: signalValues,
            type: 'scatter',
            mode: 'lines',
            name: 'Signal Line',
            line: { color: '#ffee58' },
            xaxis: 'x3',
            yaxis: 'y3'
        });

        data.push({
            x: signalTimes,
            y: histogramValues,
            type: 'bar',
            name: 'Histogram',
            yaxis: 'y3',
            marker: { color: histogramColors },
            xaxis: 'x3'
        });
    }

    if (fibonacciLevels.length > 0) {
        fibonacciLevels.forEach(level => data.push(level));
    }

    return data;
}
function updateChart(candle) {
    const updateData = {
        x: [],
        y: [],
        'line.color': []
    };
    const traceIndices = [];

    // Обновление данных для графика цен закрытия
    updateData.x.push(candle.close_time);
    updateData.y.push(candle.close_prices);
    updateData['line.color'].push(closePriceColor);
    traceIndices.push(0); 

    // Обновление SMA
    if (candle.mas) {
        candle.mas.forEach((ma, index) => {
            updateData.x.push(candle.close_time.slice(ma.period));
            updateData.y.push(ma.values);
            updateData['line.color'].push(maColors[ma.period] || 'lightblue');
            traceIndices.push(index + 1); // индексы для SMA
        });
    }
    if (candle.bb){
        const bbupper=candle.bb.map(item=>item._upper);
        const bbmiddle=candle.bb.map(item=>item._middle);
        const bblower=candle.bb.map(item=>item._lower);
        updateData.x.push(candle.close_time.slice(candle.bb_config.period),candle.close_time.slice(candle.bb_config.period),candle.close_time.slice(candle.bb_config.period))
        updateData.y.push(bbupper,bbmiddle,bblower)
        updateData['line.color'].push('red','red','red');
        traceIndices.push(
            candle.mas.length + 1,
            candle.mas.length + 2,
            candle.mas.length + 3
        )
    }
    // Обновление RSI
    if (candle.rsi.values.length>0) {
        const time_axis = candle.close_time.slice(candle.rsi.period);
        updateData.x.push(time_axis, [time_axis[0], time_axis[time_axis.length - 1]], [time_axis[0], time_axis[time_axis.length - 1]]);
        updateData.y.push(candle.rsi.values, [70, 70], [30, 30]);
        updateData['line.color'].push('#7C4DFF', 'red', 'green');
        traceIndices.push(
            candle.mas.length + 4,
            candle.mas.length + 5,
            candle.mas.length + 6
        ); // индексы для RSI
    }

    if (candle.macd) {
        const macdValues = candle.macd.map(item => item._macd);
        let signalValues = candle.macd.map(item => item._signal);
        let histogramValues = candle.macd.map(item => item._histogram);
        histogramValues = histogramValues.filter(item => item !== undefined);
        signalValues = signalValues.filter(item => item !== undefined);
        const macdTimes = candle.close_time.slice(candle.macd_periods[1] - 1);
        const signalTimes = candle.close_time.slice(candle.macd_periods[1] - 1 + candle.macd_periods[2]);

        updateData.x.push(macdTimes, signalTimes, signalTimes);
        updateData.y.push(macdValues, signalValues, histogramValues);
        updateData['line.color'].push('#3179f5', '#ffee58', histogramValues.map(value => value >= 0 ? 'rgba(0, 255, 0, 0.5)' : 'rgba(255, 0, 0, 0.5)'));
        traceIndices.push(
            candle.mas.length + 7,
            candle.mas.length + 8,
            candle.mas.length + 9
        );
    }
    if (predictionData) {
        const nextPrice = predictNextPrice(candleData.mas);
        const lastDateTime = luxon.DateTime.fromISO(candleData.close_time[candleData.close_time.length - 1]);
        const secondLastDateTime = luxon.DateTime.fromISO(candleData.close_time[candleData.close_time.length - 2]);
        const timeDifference = lastDateTime.diff(secondLastDateTime).milliseconds;
        updateData.x.push([candleData.close_time[candleData.close_time.length - 1], lastDateTime.plus({ milliseconds: timeDifference }).toISO()]);
        updateData.y.push([candleData.close_prices[candleData.close_prices.length - 1], nextPrice])
        updateData['line.color'].push('yellow');
        traceIndices.push(candle.mas.length + 10);
    }
    Plotly.update('chart', updateData, traceIndices);
    if(startIdx!=null && endIdx!=null){
        drawFibonacciLevels(startIdx,endIdx);
    }
    const chartElement = document.getElementById('chart');
    chartElement.on('plotly_selected', (eventData) => {
        if (eventData) {
            fib_candle_data=candle;
            const range = eventData.range.x;
            startIdx = getNearestIndex(range[0]);
            endIdx = getNearestIndex(range[1]);
            drawFibonacciLevels(startIdx, endIdx);
        }
    });
}
function drawFibonacciLevels(startIdx = null, endIdx = null) {
    if (!fib_candle_data) return;
    if(wasDrawn){
        let order=10;
        if(predictionData){order+=1;}
        Plotly.deleteTraces('chart', fibonacciLevels.map((_,i)=>candleData.mas.length + order + i));
    }
    fibonacciLevel=[]
    if (startIdx === null || endIdx === null) {
        if (fibonacciLevels.length === 0) return;
        startIdx = fibonacciLevels[0].startIdx;
        endIdx = fibonacciLevels[0].endIdx;
    }

    const pricesInRange = fib_candle_data.close_prices.slice(startIdx, endIdx + 1);
    const fibonacci = calculateFibonacciLevels(pricesInRange);

    fibonacciLevels = fibonacci.map(level => ({
        ...level,
        startIdx,
        endIdx
    }));

    const fibData = fibonacciLevels.map(level => ({
        x: [fib_candle_data.close_time[level.startIdx], fib_candle_data.close_time[level.endIdx]],
        y: [level.value, level.value],
        type: 'scatter',
        mode: 'lines',
        name: `Fibonacci ${level.level}`,
        line: { color: level.color }
    }));
    wasDrawn=true;
    Plotly.addTraces('chart', fibData);
}
function calculateFibonacciLevels(prices) {
    const highestHigh = Math.max(...prices);
    const lowestLow = Math.min(...prices);

    return [
        { level: '0%', value: highestHigh, color: 'rgba(255, 99, 132, 0.5)' },
        { level: '23.6%', value: highestHigh - 0.236 * (highestHigh - lowestLow), color: 'rgba(54, 162, 235, 0.5)' },
        { level: '38.2%', value: highestHigh - 0.382 * (highestHigh - lowestLow), color: 'rgba(75, 192, 192, 0.5)' },
        { level: '50%', value: highestHigh - 0.5 * (highestHigh - lowestLow), color: 'rgba(153, 102, 255, 0.5)' },
        { level: '61.8%', value: highestHigh - 0.618 * (highestHigh - lowestLow), color: 'rgba(153, 102, 255, 0.5)' },
        { level: '100%', value: lowestLow, color: 'rgba(201, 203, 207, 0.5)' }
    ];
}
function getNearestIndex(selectedTime) {
    const selectedTimeMillis = new Date(selectedTime).getTime();
    for (let i = candleData.close_time.length - 1; i >= 0; i--) {
        if (selectedTimeMillis >= new Date(candleData.close_time[i]).getTime()) {
            return i;
        }
    }
    return -1;
}
window.addEventListener('load', () => {
    setupMAControls(Object.keys(maColors).map(period => ({ period: parseInt(period) })));
});
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export async function draw_data(candle) {
    const data = [];
    // Plot Close Prices
    data.push({
        x: candle.close_time,
        y: candle.close_prices,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Close Prices'
    });
    //Plot Moving Average
    if (candle.mas) {
        candle.mas.forEach(ma => {
            data.push({
                x: candle.close_time.slice(candle.close_time.length - ma.values.length, candle.close_time.length),
                y: ma.values,
                type: 'scatter',
                mode: 'lines',
                name: `SMA (${ma.period})`
            });
        });
    }
    // Plot Fibonacci Levels and fill areas between lines
    if (candle.fibonacci_levels) {
        const fibLevels = Object.entries(candle.fibonacci_levels).map(([level, value]) => ({ level, value }));
        for (let i = 0; i < fibLevels.length; i++) {
            const { level, value } = fibLevels[i];
            const color = getColorForFibonacciLevel(level); // Get color for Fibonacci level
            data.push({
                x: [candle.close_time[0], candle.close_time[candle.close_time.length - 1]],
                y: [value, value],
                type: 'scatter',
                mode: 'lines',
                name: `Fibonacci ${level}`,
                line: { color } // Line color
            });
            if (i < fibLevels.length - 1) {
                const nextValue = fibLevels[i + 1].value;
                data.push({
                    x: [candle.close_time[0], candle.close_time[candle.close_time.length - 1], candle.close_time[candle.close_time.length - 1], candle.close_time[0]],
                    y: [value, value, nextValue, nextValue],
                    fill: 'tonexty',
                    type: 'scatter',
                    mode: 'none',
                    fillcolor: color,
                    showlegend: false
                });
            }
        }
    }
    // Define layout
    const layout = {
        title: `Price and Fibonacci Levels (${candle.interval})`,
        xaxis: { title: 'Time' },
        yaxis: { title: 'Price' },
        showlegend: true
    };
    // Create the plot HTML
    const plotHtml = `
    <html>
    <head>
        <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    </head>
    <body>
        <div id="plotly-div" style="width:100%;height:100%;"></div>
        <script>
            const data = ${JSON.stringify(data)};
            const layout = ${JSON.stringify(layout)};
            Plotly.newPlot('plotly-div', data, layout);
        </script>
    </body>
    </html>
    `;
    // Save the plot HTML to a file
    const filepath = path.join(__dirname, 'graphs', `${candle.interval}`, 'price-fibonacci-plot.html');
    fs.writeFileSync(filepath, plotHtml);
    console.log('Plot saved to price-fibonacci-plot.html');
    return filepath;
}
function getColorForFibonacciLevel(level) {
    switch (level) {
        case '23.6%': return 'rgba(255, 99, 132, 0.5)';
        case '38.2%': return 'rgba(54, 162, 235, 0.5)';
        case '50%': return 'rgba(75, 192, 192, 0.5)';
        case '61.8%': return 'rgba(153, 102, 255, 0.5)';
        default: return 'rgba(201, 203, 207, 0.5)';
    }
}
export async function draw_indicators(candle) {
    const data = [];
    if (candle.macd) {
        const macdValues = candle.macd.map(item => item._macd);
        const signalValues = candle.macd.map(item => item._signal);
        const histogramValues = candle.macd.map(item => item._histogram);
        const signalStartIndex = signalValues.findIndex(val => val !== undefined);
        const macdStartIndex = macdValues.findIndex(val => val !== undefined);
        const macd = macdValues.slice(macdStartIndex);
        const signal = signalValues.slice(signalStartIndex);
        const histogram = histogramValues.slice(signalStartIndex);
        const macdTimes = candle.close_time.slice(0, macd.length);
        const signalTimes = candle.close_time.slice(signalStartIndex);
        const histogramColors = histogram.map(value => value >= 0 ? 'rgba(0, 255, 0, 0.5)' : 'rgba(255, 0, 0, 0.5)');
        data.push({
            x: macdTimes,
            y: macd,
            type: 'scatter',
            mode: 'lines',
            name: 'MACD',
            line: { color: 'red' } // Пример цвета линии, замените на нужный
        });
        data.push({
            x: signalTimes,
            y: signal,
            type: 'scatter',
            mode: 'lines',
            name: 'Signal Line',
            line: { color: 'blue' } // Пример цвета линии, замените на нужный
        });
        data.push({
            x: signalTimes,
            y: histogram,
            type: 'bar',
            name: 'Histogram',
            yaxis: 'y2', // Secondary y-axis
            marker: { color: histogramColors } // Цвет гистограммы, заменяемый по значению
        });
    }
    // Define layout
    const layout = {
        title: `Indicators (MACD) (${candle.interval})`,
        xaxis: { title: 'Time' },
        yaxis: { title: 'Value' },
        yaxis2: {
            title: 'MACD Histogram',
            overlaying: 'y',
            side: 'right'
        },
        showlegend: true
    };
    // Create the plot HTML
    const plotHtml = `
        <html>
        <head>
            <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
        </head>
        <body>
            <div id="plotly-div" style="width:100%;height:100%;"></div>
            <script>
                const data = ${JSON.stringify(data)};
                const layout = ${JSON.stringify(layout)};
                Plotly.newPlot('plotly-div', data, layout);
            </script>
        </body>
        </html>
    `;
    // Save the plot HTML to a file
    const filepath = path.join(__dirname, 'graphs', `${candle.interval}`, 'indicators-plot.html');
    fs.writeFileSync(filepath, plotHtml);
    console.log('Plot saved to indicators-plot.html');
    return filepath;
}
export async function draw_rsi(candle) {
    const data = [];
    //Plot RSI
    if (candle.rsi) {
        data.push({
            x: candle.close_time,
            y: candle.rsi.values,
            type: 'scatter',
            mode: 'lines',
            name: 'RSI',
            line: { color: 'purple' } // Пример цвета линии, замените на нужный
        });
        // Overbought line (70)
        data.push({
            x: [candle.close_time[0], candle.close_time[candle.close_time.length - 1]],
            y: [70, 70],
            type: 'scatter',
            mode: 'lines',
            name: 'Overbought (70)',
            line: { color: 'red', dash: 'dash' } // Пример цвета линии, замените на нужный
        });
        // Oversold line (30)
        data.push({
            x: [candle.close_time[0], candle.close_time[candle.close_time.length - 1]],
            y: [30, 30],
            type: 'scatter',
            mode: 'lines',
            name: 'Oversold (30)',
            line: { color: 'green', dash: 'dash' } // Пример цвета линии, замените на нужный
        });
    }
    // Define layout
    const layout = {
        title: `RSI (${candle.interval})`,
        xaxis: { title: 'Time' },
        yaxis: { title: 'RSI Value' },
        showlegend: true
    };
    // Create the plot HTML
    const plotHtml = `
        <html>
        <head>
            <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
        </head>
        <body>
            <div id="plotly-div" style="width:100%;height:100%;"></div>
            <script>
                const data = ${JSON.stringify(data)};
                const layout = ${JSON.stringify(layout)};
                Plotly.newPlot('plotly-div', data, layout);
            </script>
        </body>
        </html>
    `;
    // Save the plot HTML to a file
    const filepath = path.join(__dirname, 'graphs', `${candle.interval}`, 'rsi-plot.html');
    fs.writeFileSync(filepath, plotHtml);
    console.log('Plot saved to rsi-plot.html');
    return filepath;
}

#!/usr/bin/env python3
"""
Simplified Technical Analysis Service for Render
Works with just numpy and pandas (no TA-Lib required)
"""

import sys
import json
import numpy as np
import pandas as pd

def calculate_rsi(prices, period=14):
    """Calculate RSI using pandas"""
    df = pd.DataFrame({'price': prices})
    delta = df['price'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi.iloc[-1] if not pd.isna(rsi.iloc[-1]) else 50.0

def calculate_sma(prices, period):
    """Calculate Simple Moving Average"""
    return pd.Series(prices).rolling(window=period).mean().iloc[-1]

def calculate_ema(prices, period):
    """Calculate Exponential Moving Average"""
    return pd.Series(prices).ewm(span=period, adjust=False).mean().iloc[-1]

def calculate_bollinger_bands(prices, period=20, std_dev=2):
    """Calculate Bollinger Bands"""
    sma = pd.Series(prices).rolling(window=period).mean()
    std = pd.Series(prices).rolling(window=period).std()
    upper = sma + (std * std_dev)
    middle = sma
    lower = sma - (std * std_dev)
    return {
        'upper': upper.iloc[-1],
        'middle': middle.iloc[-1],
        'lower': lower.iloc[-1]
    }

def calculate_macd(prices, fast=12, slow=26, signal=9):
    """Calculate MACD"""
    ema_fast = pd.Series(prices).ewm(span=fast, adjust=False).mean()
    ema_slow = pd.Series(prices).ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return {
        'macd': macd_line.iloc[-1],
        'signal': signal_line.iloc[-1],
        'histogram': histogram.iloc[-1]
    }

def calculate_stochastic(highs, lows, closes, period=14):
    """Calculate Stochastic Oscillator"""
    high_roll = pd.Series(highs).rolling(window=period).max()
    low_roll = pd.Series(lows).rolling(window=period).min()
    
    k = 100 * (closes - low_roll) / (high_roll - low_roll)
    d = k.rolling(window=3).mean()
    
    return {
        'k': k.iloc[-1] if not pd.isna(k.iloc[-1]) else 50.0,
        'd': d.iloc[-1] if not pd.isna(d.iloc[-1]) else 50.0
    }

def calculate_atr(highs, lows, closes, period=14):
    """Calculate Average True Range"""
    high = pd.Series(highs)
    low = pd.Series(lows)
    close = pd.Series(closes)
    
    tr1 = high - low
    tr2 = abs(high - close.shift())
    tr3 = abs(low - close.shift())
    
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.rolling(window=period).mean()
    
    return atr.iloc[-1] if not pd.isna(atr.iloc[-1]) else 0.0

def analyze_data(data):
    """Main analysis function"""
    try:
        prices = np.array(data.get('prices', []), dtype=float)
        highs = np.array(data.get('highs', prices), dtype=float)
        lows = np.array(data.get('lows', prices), dtype=float)
        
        if len(prices) < 30:
            return {'success': False, 'error': 'Need at least 30 data points'}
        
        # Calculate indicators
        rsi_14 = calculate_rsi(prices, 14)
        rsi_7 = calculate_rsi(prices, 7)
        rsi_21 = calculate_rsi(prices, 21)
        
        bb = calculate_bollinger_bands(prices)
        macd_data = calculate_macd(prices)
        stoch = calculate_stochastic(highs, lows, prices)
        atr = calculate_atr(highs, lows, prices, 14)
        
        sma_20 = calculate_sma(prices, 20)
        sma_50 = calculate_sma(prices, 50)
        ema_12 = calculate_ema(prices, 12)
        ema_26 = calculate_ema(prices, 26)
        
        # Calculate signals
        signals = []
        
        if rsi_14 < 30:
            signals.append('RSI_OVERSOLD')
        elif rsi_14 > 70:
            signals.append('RSI_OVERBOUGHT')
        
        if macd_data['macd'] > macd_data['signal']:
            signals.append('MACD_BULLISH')
        else:
            signals.append('MACD_BEARISH')
        
        current_price = prices[-1]
        if current_price < bb['lower']:
            signals.append('BB_OVERSOLD')
        elif current_price > bb['upper']:
            signals.append('BB_OVERBOUGHT')
        
        if sma_20 > sma_50:
            signals.append('TREND_BULLISH')
        else:
            signals.append('TREND_BEARISH')
        
        # Generate summary
        bullish_signals = ['RSI_OVERSOLD', 'MACD_BULLISH', 'BB_OVERSOLD', 'TREND_BULLISH']
        bearish_signals = ['RSI_OVERBOUGHT', 'MACD_BEARISH', 'BB_OVERBOUGHT', 'TREND_BEARISH']
        
        bullish_count = sum(1 for s in signals if s in bullish_signals)
        bearish_count = sum(1 for s in signals if s in bearish_signals)
        
        if bullish_count > bearish_count:
            action = 'BUY'
            confidence = min(bullish_count * 0.2, 0.8)
        elif bearish_count > bullish_count:
            action = 'SELL'
            confidence = min(bearish_count * 0.2, 0.8)
        else:
            action = 'HOLD'
            confidence = 0.5
        
        return {
            'success': True,
            'indicators': {
                'rsi': {
                    'rsi_14': float(rsi_14),
                    'rsi_7': float(rsi_7),
                    'rsi_21': float(rsi_21)
                },
                'macd': {
                    'macd': float(macd_data['macd']),
                    'signal': float(macd_data['signal']),
                    'histogram': float(macd_data['histogram']),
                    'trend': 'BULLISH' if macd_data['macd'] > macd_data['signal'] else 'BEARISH'
                },
                'bollinger': {
                    'upper': float(bb['upper']),
                    'middle': float(bb['middle']),
                    'lower': float(bb['lower']),
                    'position': calculate_bb_position(current_price, bb['upper'], bb['lower'])
                },
                'stochastic': {
                    'k': float(stoch['k']),
                    'd': float(stoch['d']),
                    'signal': 'OVERSOLD' if stoch['k'] < 20 else 'OVERBOUGHT' if stoch['k'] > 80 else 'NEUTRAL'
                },
                'atr': {
                    'value': float(atr),
                    'volatility': 'HIGH' if atr > current_price * 0.05 else 'MEDIUM' if atr > current_price * 0.02 else 'LOW'
                },
                'moving_averages': {
                    'sma_20': float(sma_20),
                    'sma_50': float(sma_50),
                    'ema_12': float(ema_12),
                    'ema_26': float(ema_26),
                    'trend': 'BULLISH' if sma_20 > sma_50 else 'BEARISH'
                }
            },
            'signals': signals,
            'summary': {
                'action': action,
                'strength': max(bullish_count, bearish_count),
                'confidence': confidence
            }
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

def calculate_bb_position(price, upper, lower):
    """Calculate position within Bollinger Bands"""
    if upper == lower:
        return 'UNKNOWN'
    position = (price - lower) / (upper - lower)
    if position < 0.2:
        return 'LOWER'
    elif position > 0.8:
        return 'UPPER'
    else:
        return 'MIDDLE'

def main():
    """Main entry point"""
    try:
        input_data = json.load(sys.stdin)
        result = analyze_data(input_data)
        print(json.dumps(result))
    except Exception as e:
        error_result = {
            'success': False,
            'error': f'Python analysis failed: {str(e)}'
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == '__main__':
    main()


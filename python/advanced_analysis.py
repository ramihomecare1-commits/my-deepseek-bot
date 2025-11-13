#!/usr/bin/env python3
"""
Advanced Technical Analysis Service
Uses TA-Lib for professional-grade indicators
Called by Node.js bot for enhanced analysis
"""

import sys
import json
import numpy as np
import talib
from scipy.signal import find_peaks

def calculate_advanced_indicators(data):
    """
    Calculate advanced technical indicators using TA-Lib
    
    Args:
        data: dict with 'prices', 'highs', 'lows', 'volumes'
    
    Returns:
        dict with advanced indicators
    """
    try:
        prices = np.array(data.get('prices', []), dtype=float)
        highs = np.array(data.get('highs', prices), dtype=float)
        lows = np.array(data.get('lows', prices), dtype=float)
        volumes = np.array(data.get('volumes', [1] * len(prices)), dtype=float)
        
        if len(prices) < 30:
            return {'error': 'Need at least 30 data points'}
        
        # Advanced RSI (multiple periods)
        rsi_14 = talib.RSI(prices, timeperiod=14)
        rsi_7 = talib.RSI(prices, timeperiod=7)
        rsi_21 = talib.RSI(prices, timeperiod=21)
        
        # MACD (Moving Average Convergence Divergence)
        macd, macd_signal, macd_hist = talib.MACD(prices, 
                                                    fastperiod=12, 
                                                    slowperiod=26, 
                                                    signalperiod=9)
        
        # Bollinger Bands (multiple periods)
        bb_upper, bb_middle, bb_lower = talib.BBANDS(prices, 
                                                       timeperiod=20,
                                                       nbdevup=2,
                                                       nbdevdn=2)
        
        # ADX (Average Directional Index) - Trend strength
        adx = talib.ADX(highs, lows, prices, timeperiod=14)
        
        # Stochastic Oscillator
        slowk, slowd = talib.STOCH(highs, lows, prices,
                                    fastk_period=14,
                                    slowk_period=3,
                                    slowd_period=3)
        
        # ATR (Average True Range) - Volatility
        atr = talib.ATR(highs, lows, prices, timeperiod=14)
        
        # OBV (On Balance Volume) - Volume analysis
        obv = talib.OBV(prices, volumes)
        
        # Williams %R
        willr = talib.WILLR(highs, lows, prices, timeperiod=14)
        
        # CCI (Commodity Channel Index)
        cci = talib.CCI(highs, lows, prices, timeperiod=14)
        
        # MFI (Money Flow Index) - Volume-weighted RSI
        mfi = talib.MFI(highs, lows, prices, volumes, timeperiod=14)
        
        # Moving Averages
        sma_20 = talib.SMA(prices, timeperiod=20)
        sma_50 = talib.SMA(prices, timeperiod=50)
        ema_12 = talib.EMA(prices, timeperiod=12)
        ema_26 = talib.EMA(prices, timeperiod=26)
        
        # Parabolic SAR (Stop and Reverse)
        sar = talib.SAR(highs, lows, acceleration=0.02, maximum=0.2)
        
        # Get latest values (last point)
        def get_last(arr):
            return float(arr[-1]) if len(arr) > 0 and not np.isnan(arr[-1]) else None
        
        # Detect divergences
        price_peaks, _ = find_peaks(prices[-50:])
        rsi_peaks, _ = find_peaks(rsi_14[-50:])
        
        # Determine overall signal
        signals = []
        
        # RSI signals
        if get_last(rsi_14) < 30:
            signals.append('RSI_OVERSOLD')
        elif get_last(rsi_14) > 70:
            signals.append('RSI_OVERBOUGHT')
        
        # MACD signals
        if get_last(macd) > get_last(macd_signal):
            signals.append('MACD_BULLISH')
        else:
            signals.append('MACD_BEARISH')
        
        # ADX signals (trend strength)
        adx_value = get_last(adx)
        if adx_value and adx_value > 25:
            signals.append('STRONG_TREND')
        elif adx_value and adx_value < 20:
            signals.append('WEAK_TREND')
        
        # Bollinger Bands signals
        current_price = prices[-1]
        if current_price < get_last(bb_lower):
            signals.append('BB_OVERSOLD')
        elif current_price > get_last(bb_upper):
            signals.append('BB_OVERBOUGHT')
        
        return {
            'success': True,
            'indicators': {
                'rsi': {
                    'rsi_14': get_last(rsi_14),
                    'rsi_7': get_last(rsi_7),
                    'rsi_21': get_last(rsi_21)
                },
                'macd': {
                    'macd': get_last(macd),
                    'signal': get_last(macd_signal),
                    'histogram': get_last(macd_hist),
                    'trend': 'BULLISH' if get_last(macd) > get_last(macd_signal) else 'BEARISH'
                },
                'bollinger': {
                    'upper': get_last(bb_upper),
                    'middle': get_last(bb_middle),
                    'lower': get_last(bb_lower),
                    'position': calculate_bb_position(current_price, get_last(bb_upper), get_last(bb_lower))
                },
                'adx': {
                    'value': get_last(adx),
                    'strength': 'STRONG' if adx_value and adx_value > 25 else 'WEAK'
                },
                'stochastic': {
                    'k': get_last(slowk),
                    'd': get_last(slowd),
                    'signal': 'OVERSOLD' if get_last(slowk) < 20 else 'OVERBOUGHT' if get_last(slowk) > 80 else 'NEUTRAL'
                },
                'atr': {
                    'value': get_last(atr),
                    'volatility': 'HIGH' if get_last(atr) > prices[-1] * 0.05 else 'LOW'
                },
                'obv': get_last(obv),
                'williams_r': get_last(willr),
                'cci': get_last(cci),
                'mfi': get_last(mfi),
                'moving_averages': {
                    'sma_20': get_last(sma_20),
                    'sma_50': get_last(sma_50),
                    'ema_12': get_last(ema_12),
                    'ema_26': get_last(ema_26),
                    'trend': 'BULLISH' if get_last(sma_20) > get_last(sma_50) else 'BEARISH'
                },
                'sar': get_last(sar)
            },
            'signals': signals,
            'summary': generate_summary(signals)
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

def calculate_bb_position(price, upper, lower):
    """Calculate position within Bollinger Bands"""
    if not upper or not lower or upper == lower:
        return 'UNKNOWN'
    
    position = (price - lower) / (upper - lower)
    
    if position < 0.2:
        return 'LOWER'
    elif position > 0.8:
        return 'UPPER'
    else:
        return 'MIDDLE'

def generate_summary(signals):
    """Generate trading summary from signals"""
    bullish_signals = ['RSI_OVERSOLD', 'MACD_BULLISH', 'BB_OVERSOLD']
    bearish_signals = ['RSI_OVERBOUGHT', 'MACD_BEARISH', 'BB_OVERBOUGHT']
    
    bullish_count = sum(1 for s in signals if s in bullish_signals)
    bearish_count = sum(1 for s in signals if s in bearish_signals)
    
    if bullish_count > bearish_count:
        return {
            'action': 'BUY',
            'strength': bullish_count,
            'confidence': min(bullish_count * 0.25, 0.85)
        }
    elif bearish_count > bullish_count:
        return {
            'action': 'SELL',
            'strength': bearish_count,
            'confidence': min(bearish_count * 0.25, 0.85)
        }
    else:
        return {
            'action': 'HOLD',
            'strength': 0,
            'confidence': 0.5
        }

def main():
    """Main entry point - reads JSON from stdin, outputs JSON to stdout"""
    try:
        # Read input from Node.js
        input_data = json.load(sys.stdin)
        
        # Calculate indicators
        result = calculate_advanced_indicators(input_data)
        
        # Output JSON to stdout
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


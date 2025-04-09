import React, { useEffect, useRef } from 'react';

interface TradingViewChartProps {
  symbol: string;
  tokenAddress: string;
  height?: number;
  heliusEndpoint?: string;
}

export const TradingViewChart: React.FC<TradingViewChartProps> = ({
  symbol,
  tokenAddress,
  height = 600,
  heliusEndpoint
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous content
    containerRef.current.innerHTML = '';

    // Create the widget container
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;

    // Configure the widget
    const config = {
      "autosize": true,
      "symbol": `${symbol.toUpperCase()}USDT`,
      "interval": "D",
      "timezone": "Etc/UTC",
      "theme": "dark",
      "style": "1",
      "locale": "en",
      "enable_publishing": false,
      "backgroundColor": "#000000",
      "gridColor": "#333333",
      "allow_symbol_change": true,
      "calendar": true,
      "support_host": "https://www.tradingview.com",
      "width": "100%",
      "height": height,
      "save_image": true,
      "show_popup_button": true,
      "popup_width": "1000",
      "popup_height": "650",
      "toolbar_bg": "#000000",
      "hide_side_toolbar": false,
      "withdateranges": true,
      "details": true,
      "hotlist": true,
      "studies": [
        "MASimple@tv-basicstudies",
        "RSI@tv-basicstudies",
        "MACD@tv-basicstudies",
        "BB@tv-basicstudies"
      ],
      "container_id": `tradingview_${Math.random().toString(36).substring(7)}`,
      "disabled_features": [
        "header_symbol_search"
      ],
      "enabled_features": [
        "study_templates",
        "use_localstorage_for_settings",
        "side_toolbar_in_fullscreen_mode",
        "header_indicators",
        "header_chart_type",
        "header_compare",
        "header_interval_dialog_button",
        "show_interval_dialog_on_key_press",
        "header_screenshot",
        "header_fullscreen_button",
        "header_settings",
        "header_resolutions",
        "header_widget_dom_node",
        "legend_widget",
        "study_templates",
        "adaptive_logo",
        "volume_force_overlay"
      ],
      "overrides": {
        // Chart background and grid
        "paneProperties.background": "#000000",
        "paneProperties.backgroundType": "solid",
        "paneProperties.vertGridProperties.color": "#333333",
        "paneProperties.horzGridProperties.color": "#333333",
        "paneProperties.crossHairProperties.color": "#cccccc",
        
        // Candlestick colors
        "mainSeriesProperties.candleStyle.upColor": "#00ff00",
        "mainSeriesProperties.candleStyle.downColor": "#ff0000",
        "mainSeriesProperties.candleStyle.borderUpColor": "#00ff00",
        "mainSeriesProperties.candleStyle.borderDownColor": "#ff0000",
        "mainSeriesProperties.candleStyle.wickUpColor": "#00ff00",
        "mainSeriesProperties.candleStyle.wickDownColor": "#ff0000",
        
        // Scale (price axis)
        "scalesProperties.backgroundColor": "#000000",
        "scalesProperties.lineColor": "#333333",
        "scalesProperties.textColor": "#cccccc",
        
        // Watermark
        "symbolWatermarkProperties.color": "rgba(204, 204, 204, 0.1)",
        
        // Chart layout
        "chartProperties.background": "#000000",
        "chartProperties.lineColor": "#333333",
        "chartProperties.textColor": "#cccccc"
      },
      "studies_overrides": {
        // Volume colors
        "volume.volume.color.0": "#ff0000",
        "volume.volume.color.1": "#00ff00",
        "volume.volume.transparency": 50,
        
        // Moving Average colors
        "MA Cross.plot.color": "#3b82f6",
        "MA Cross.signal.color": "#f59e0b",
        
        // RSI colors
        "RSI.upper.line.color": "#00ff00",
        "RSI.lower.line.color": "#ff0000",
        "RSI.plot.color": "#3b82f6",
        
        // MACD colors
        "MACD.histogram.color": "#3b82f6",
        "MACD.signal.color": "#f59e0b",
        "MACD.macd.color": "#00ff00"
      }
    };

    script.innerHTML = JSON.stringify(config);

    // Create widget container
    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'tradingview-widget-container';
    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';
    
    const widget = document.createElement('div');
    widget.id = config.container_id;
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';
    widget.style.width = '100%';
    widgetContainer.appendChild(widget);
    
    // Add script to container
    widgetContainer.appendChild(script);
    
    // Add to DOM
    containerRef.current.appendChild(widgetContainer);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol, height]);

  return (
    <div 
      ref={containerRef}
      style={{ 
        height: `${height}px`,
        width: '100%',
        backgroundColor: '#000000'
      }}
    />
  );
};
import React from 'react'
import { Button } from '@/components/ui/button'
import TradingViewWidget from '@/components/TradingView'
import { MARKET_DATA_WIDGET_CONFIG, MARKET_OVERVIEW_WIDGET_CONFIG, TOP_STORIES_WIDGET_CONFIG } from '@/lib/constant'
import SearchCommand from '@/components/SearchCommand'
import { searchStocks } from '@/lib/actions/finnhub.actions'

const Home = async () => {
  const initialStocks = await searchStocks()
  const scriptUrl = 'https://s3.tradingview.com/external-embedding/embed-widget-'
  return (
    <div className='flex min-h-screen home-wrapper'>
      <SearchCommand renderAs='button' label='Search stocks' initialStocks={initialStocks} externalOnly />
      <section className='grid w-full gap-8 home-section'>
        <div className='md:col-span-1 xl:col-span-1'>
          <TradingViewWidget
            title='MarketOverview'
            scriptUrl={`${scriptUrl}market-overview.js`}
            config={MARKET_OVERVIEW_WIDGET_CONFIG}
            className='custom-chart'
          />
        </div>
        <div className='md:col-span-2 xl:col-span-2'>
          <TradingViewWidget
            title='Stockheat Map'
            scriptUrl={`${scriptUrl}stock-heatmap.js`}
            config={MARKET_OVERVIEW_WIDGET_CONFIG}
            
          />
        </div>

      </section>
       <section className='grid w-full gap-8 home-section'>
        <div className='h-full md:col-span-1 xl:col-span-1'>
          <TradingViewWidget
            scriptUrl={`${scriptUrl}timeline.js`}
            config={TOP_STORIES_WIDGET_CONFIG}
            className='custom-chart'
          />
        </div>
        <div className='h-full md:col-span-1 xl:col-span-2'>
          <TradingViewWidget
            scriptUrl={`${scriptUrl}market-quotes.js`}
            config={MARKET_DATA_WIDGET_CONFIG}
            
          />
        </div>

      </section>
    </div>
  )
}

export default Home
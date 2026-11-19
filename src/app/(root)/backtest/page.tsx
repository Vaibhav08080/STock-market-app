import type { Metadata } from 'next'
import { StrategyLab } from '@/components/strategy-lab/StrategyLab'

export const metadata: Metadata = { title: 'Backtest' }

export default function BacktestPage() {
  return (
    <div className='flex flex-col gap-5'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold text-gray-100'>AI Strategy Lab</h1>
          <p className='text-sm text-gray-500 mt-1'>
            Describe a strategy in plain English → verified code → walk-forward backtest with costs, deflated Sharpe and buy-and-hold comparison.
          </p>
        </div>
      </div>
      <div className='strategy-lab flex h-[calc(100vh-220px)] min-h-[680px] overflow-hidden rounded-lg border border-gray-600'>
        <StrategyLab />
      </div>
    </div>
  )
}

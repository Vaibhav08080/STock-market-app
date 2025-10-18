import SearchCommand from "@/components/SearchCommand"
import { searchStocks } from "@/lib/actions/finnhub.actions"

export default async function Page() {
  const initialStocks = await searchStocks()
  return (
    <main style={{ padding: 24 }}>
      <h1 className="text-2xl font-semibold mb-4">Search</h1>
      <SearchCommand renderAs="button" label="Search stocks" initialStocks={initialStocks} />
    </main>
  )
}

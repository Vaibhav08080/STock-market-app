import { useEffect, useMemo, useRef } from "react"

export function useDebounce<T extends (...args: any[]) => any>(fn: T, delay = 300) {
  const fnRef = useRef(fn)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  const debounced = useMemo(() => {
    const wrapped = (...args: Parameters<T>) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        fnRef.current(...args)
      }, delay)
    }
    return wrapped as (...args: Parameters<T>) => ReturnType<T>
  }, [delay])

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return debounced
}

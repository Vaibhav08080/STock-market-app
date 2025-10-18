'use client'

import { NAV_ITEMS } from '@/lib/constant'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React from 'react'

const Navitem = () => {
  const pathname = usePathname()
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/')

  return (
    <ul className='flex flex-col sm:flex-row p-2 gap-1 sm:gap-10 font-medium divide-y divide-white/10 sm:divide-y-0'>
      {NAV_ITEMS.map(({ href, label }) => (
        <li key={href}>
          <Link
            href={href}
            className={`block py-2 hover:text-yellow-500 transition-colors ${isActive(href) ? 'text-gray-100' : ''}`}
            aria-current={isActive(href) ? 'page' : undefined}
            onClick={(e) => {
              if (href === '/search') {
                e.preventDefault()
                window.dispatchEvent(new Event('open-search'))
              }
            }}
          >
            {label}
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default Navitem
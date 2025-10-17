import React from 'react'
import Link from 'next/link'

const FooterLink = ({text , linkText , href}:FooterLinkProps) => {
  return (
    <div className='text-center pt-4'>
        <p className='text-sm text-gray-500'>{text}{' '}</p>
       <Link href={href} className='footer-link'>{linkText}</Link>
    </div>
  )
}

export default FooterLink
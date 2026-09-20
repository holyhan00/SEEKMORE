               
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

         
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

        
export function truncate(text: string, maxLength = 100, ellipsis = '...'): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength) + ellipsis
}

                   
export function generateId(prefix = 'id'): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

              
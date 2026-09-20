                           
type ErrorLog = {
  error: Error
  errorInfo?: ErrorInfo
  component?: string
  timestamp: string
}

export function sendErrorLog(log: ErrorLog) {
                 
  if (process.env.NODE_ENV === 'production') {
    console.error('Error logged:', log)
                                    
  } else {
    console.groupCollapsed('[DEV] Error Debug')
                                            
    console.error(log.error)
                                                              
    console.groupEnd()
  }
}

       
export interface ErrorInfo {
  componentStack: string | null | undefined;                          
}
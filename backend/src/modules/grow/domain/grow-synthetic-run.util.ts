type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

   
                                                                       
                                                                       
                                                                       
   
export function getGrowExecutionKind(requestJson: unknown): string | null {
  const request = asRecord(requestJson);
  if (!request) return null;

  const executionContext = asRecord(request.executionContext);
  const kind = executionContext?.kind;
  return typeof kind === 'string' ? kind : null;
}

   
                                                                         
                                                                             
                                  
   
export function isGrowSyntheticTrace(traceId?: string | null): boolean {
  return Boolean(traceId?.startsWith('grow-focus:'));
}

   
                                                                              
                                                                            
                                               
   
export function isGrowSyntheticRun(input: {
  traceId?: string | null;
  requestJson?: unknown;
}): boolean {
  return (
    getGrowExecutionKind(input.requestJson) === 'grow_focus'
    || isGrowSyntheticTrace(input.traceId)
  );
}

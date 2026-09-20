   
                                                                            
  
                                                                              
                                                                              
                                                                             
                                                                           
   
export class ModelVisibleContentSanitizer {
  private buffer = '';
  private insideDsmlToolCalls = false;

  push(delta: string): string {
    if (!delta) return '';
    this.buffer += delta;
    return this.drain(false);
  }

  flush(): string {
    return this.drain(true);
  }

  sanitizeComplete(content: string): string {
    const sanitizer = new ModelVisibleContentSanitizer();
    return sanitizer.push(content) + sanitizer.flush();
  }

  private drain(final: boolean): string {
    let visible = '';

    while (this.buffer) {
      const tagStart = this.buffer.indexOf('<');

      if (tagStart < 0) {
        if (!this.insideDsmlToolCalls) visible += this.buffer;
        this.buffer = '';
        break;
      }

      if (!this.insideDsmlToolCalls && tagStart > 0) {
        visible += this.buffer.slice(0, tagStart);
      }
      this.buffer = this.buffer.slice(tagStart);

      const tagEnd = this.buffer.indexOf('>');
      if (tagEnd < 0) {
        if (final) {
          if (!this.insideDsmlToolCalls) visible += this.buffer;
          this.buffer = '';
          this.insideDsmlToolCalls = false;
        }
        break;
      }

      const tag = this.buffer.slice(0, tagEnd + 1);
      this.buffer = this.buffer.slice(tagEnd + 1);

      if (this.isDsmlToolCallsOpen(tag)) {
        this.insideDsmlToolCalls = true;
        continue;
      }

      if (this.isDsmlToolCallsClose(tag)) {
        this.insideDsmlToolCalls = false;
        continue;
      }

      if (!this.insideDsmlToolCalls) visible += tag;
    }

    if (final && this.insideDsmlToolCalls) {
      this.buffer = '';
      this.insideDsmlToolCalls = false;
    }

    return visible;
  }

  private isDsmlToolCallsOpen(tag: string): boolean {
    return /^<\|+dsml\|+tool_calls>$/i.test(this.normalizeTag(tag));
  }

  private isDsmlToolCallsClose(tag: string): boolean {
    return /^<\/\|+dsml\|+tool_calls>$/i.test(this.normalizeTag(tag));
  }

  private normalizeTag(tag: string): string {
    return tag
      .replace(/｜/g, '|')
      .replace(/\s+/g, '')
      .toLowerCase();
  }
}

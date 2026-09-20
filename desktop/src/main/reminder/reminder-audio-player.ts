                                                     
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  realpathSync,
  statSync,
} from 'node:fs';

type AudioFileDiagnostics = {
  audioPath: string;
  resolvedAudioPath: string | null;
  exists: boolean;
  sizeBytes: number | null;
};

export class ReminderAudioPlayer {
  private process: ChildProcess | null = null;
  private active = false;

  constructor(private readonly audioPath: string) {
                                                               
                                 
                                 
                         
       
  }

  start(): boolean {
    const diagnostics = this.inspectAudioFile();

                                                      
                     
                                 
                         
                          
                                          
       

    if (this.active) {
                                                                
                                            
         

      return true;
    }

    if (process.platform !== 'darwin') {
      console.error('[DesktopReminder] Unsupported audio platform', {
        platform: process.platform,
        audioPath: this.audioPath,
      });

      return false;
    }

    if (!diagnostics.exists) {
      console.error('[DesktopReminder] Reminder audio is missing', {
        audioPath: this.audioPath,
        cwd: process.cwd(),
      });

      return false;
    }

    this.active = true;
    this.playNext();

    return true;
  }

  stop(): void {
                                                     
                          
                                          
                                
       

    this.active = false;

    const current = this.process;
    this.process = null;

    if (current && !current.killed) {
      const killed = current.kill('SIGTERM');

                                                                     
                                 
               
         
    }
  }

  dispose(): void {
                                                       
    this.stop();
  }

  private playNext(): void {
    if (!this.active) {
                                                                               
      return;
    }

    const diagnostics = this.inspectAudioFile();

    if (!diagnostics.exists) {
      this.active = false;

      console.error(
        '[DesktopReminder] Audio disappeared before playback',
        diagnostics,
      );

      return;
    }

                                                      
                                    
                     
       

    let child: ChildProcess;

    try {
      child = spawn(
        '/usr/bin/afplay',
        [this.audioPath],
        {
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );
    } catch (error) {
      this.active = false;

      console.error('[DesktopReminder] Failed to create afplay process', {
        error,
        audioPath: this.audioPath,
      });

      return;
    }

    this.process = child;

                                                     
                             
                                
       

    let stderr = '';

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    child.once('error', (error) => {
      if (this.process === child) {
        this.process = null;
      }

      this.active = false;

      console.error('[DesktopReminder] Failed to spawn afplay', {
        error,
        pid: child.pid ?? null,
        audioPath: this.audioPath,
      });
    });

    child.once('exit', (code, signal) => {
      if (this.process === child) {
        this.process = null;
      }

      const wasStoppedByApplication =
        !this.active && signal === 'SIGTERM';

      if (wasStoppedByApplication) {
                                                                  
                                 
               
                 
           

        return;
      }

      if (code !== 0) {
        this.active = false;

        console.error('[DesktopReminder] afplay exited abnormally', {
          pid: child.pid ?? null,
          code,
          signal,
          stderr: stderr.trim() || null,
          audioPath: this.audioPath,
        });

        return;
      }

                                                         
                               
             
               
                            
                                  
         

      if (this.active) {
        setImmediate(() => {
          this.playNext();
        });
      }
    });
  }

  private inspectAudioFile(): AudioFileDiagnostics {
    const exists = existsSync(this.audioPath);

    if (!exists) {
      return {
        audioPath: this.audioPath,
        resolvedAudioPath: null,
        exists: false,
        sizeBytes: null,
      };
    }

    try {
      return {
        audioPath: this.audioPath,
        resolvedAudioPath: realpathSync(this.audioPath),
        exists: true,
        sizeBytes: statSync(this.audioPath).size,
      };
    } catch (error) {
      console.error(
        '[DesktopReminder] Failed to inspect reminder audio',
        {
          error,
          audioPath: this.audioPath,
        },
      );

      return {
        audioPath: this.audioPath,
        resolvedAudioPath: null,
        exists: true,
        sizeBytes: null,
      };
    }
  }
}
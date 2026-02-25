import { EventEmitter } from 'events';

import type { ScheduledTask } from './types.js';

class TaskEventBus extends EventEmitter {
  emitTaskUpdate(task: ScheduledTask): void {
    this.emit('task_update', { task });
  }

  onTaskUpdate(
    listener: (event: { task: ScheduledTask }) => void,
  ): () => void {
    this.on('task_update', listener);
    return () => this.off('task_update', listener);
  }
}

export const taskEventBus = new TaskEventBus();

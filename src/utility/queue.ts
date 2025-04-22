export default class Queue<T> {
  private queue: T[];

  constructor() {
    this.queue = [];
  }
  enqueue(item: T) {
    this.queue.push(item);
  }
  dequeue(): T | undefined {
    return this.queue.shift();
  }
  isEmpty() {
    return this.queue.length === 0;
  }
}

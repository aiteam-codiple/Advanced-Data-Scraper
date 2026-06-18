import { EventEmitter } from 'events';

class JobEmitter extends EventEmitter {}

const jobEmitter = new JobEmitter();

export default jobEmitter;

/** Web front end that renders the parsed output. */
import { parseIt } from '../core/index.js';
import { pad } from '../packages/util';
export default function run() { return pad(parseIt('x')); }

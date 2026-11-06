/** Versions the server checks on submit: an outdated client or different tuning cannot post scores. */
import { tuningHash } from '../sim/replay';

export const CLIENT_VERSION = '0.10.0';
export const tuningFingerprint = (): string => tuningHash();

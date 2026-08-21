import { calculateRepop } from "./cal.js";

const WORKER_TYPES = {
    CALCULATE: "CALCULATE",
    RESULT: "RESULT",
    ERROR: "ERROR"
};

self.onmessage = function (e) {
    const { type, mob, maintenance, options } = e.data;

    if (type === WORKER_TYPES.CALCULATE) {
        try {
            const result = calculateRepop(mob, maintenance, options);
            self.postMessage({
                type: WORKER_TYPES.RESULT,
                mobNo: mob.No,
                repopInfo: result,
                spawnCache: mob._spawnCache
            });
        } catch (error) {
            self.postMessage({
                type: WORKER_TYPES.ERROR,
                mobNo: mob.No,
                error: error.message
            });
        }
    }
};



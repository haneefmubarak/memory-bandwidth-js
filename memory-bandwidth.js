const microtime = require ("microtime");
const bytesize = require("byte-size");
const { Worker, isMainThread, workerData } = require ("node:worker_threads");

function loop (data, skip) {
	const n = data.length;
	skip |= 0;

	let acc = 0;
	let x = 0;
	for (x = 0; x < n; x += skip) {
		acc += data[x];
		acc |= 0;	// prevent overflow
	}

	return acc;
}

const genArray = (n) => Float64Array.from({length: n}, () => (0.5));

const y = () => new Promise(r => setImmediate(r));

let l = (x) => { y(); console.log(x); };

// async to enable await for printf debugging from threads since IO is on main thread
(async () => {
if (isMainThread) {
	if ((process.argv.length) != 4) {
		console.log("Usage: node ./memory.js data-volume threads")
	}

	const sab = new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT);
	const threads = Number(process.argv[3]);
	const params = {
		dvolume: Number(process.argv[2]),
		garbage: new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT),
		threads: threads,
		lockbuf: sab,
		cachesz: 64
	};

	// initialize spinlock, counter
	const i32l = new Int32Array(sab);
	Atomics.store(i32l, 0, 0);
	Atomics.store(i32l, 1, 0);

	// initialize threads
	let x = 0;
	for (x = 0; x < threads; x++) {
		new Worker(
			__filename,
			{ workerData: params }
		);
	}

	// wait for all-ready, then dispatch
	while (Atomics.load(i32l, 0) != threads);

	Atomics.store(i32l, 0, 0);

	const start = microtime.nowStruct();
	Atomics.store(i32l, 1, 1);

	// wait for all-finished
	while (Atomics.load(i32l, 0) != threads);

	const end = microtime.nowStruct();

	// calculate time and speed
	const us = ((end[0] - start[0]) * 1000000) + (end[1] - start[1]);
	const speed = bytesize((params.dvolume / us) * 1000000);

	console.log(`Read ~${params.dvolume} bytes in ~${us} us for an estimated\n~${speed.value} ${speed.unit}/s totalled across ${threads} threads.`)

	return 0;
} else {
	const params = workerData;

	const sizeof = Float64Array.BYTES_PER_ELEMENT;
	const tvolume = params.dvolume / (sizeof * params.threads);
	const data = genArray(tvolume);

	// notify ready
	const i32l = new Int32Array(params.lockbuf);
	Atomics.add(i32l, 0, 1);


	// wait
	while (Atomics.load(i32l, 1) != 1);

	// run.
	let result = loop(data, params.cachesz / sizeof);

	// notify finished
	Atomics.add(i32l, 0, 1);
	Atomics.notify(i32l, 0);

	// prevent loop() from being optimized out in the future
	const u8g = new Float64Array(params.garbage);
	u8g[0] = result;
}
})();

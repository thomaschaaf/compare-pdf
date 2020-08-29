const _ = require('lodash');
const fs = require('fs-extra');
const path = require('path');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');
const utils = require('./utils');

const comparePngs = async (actual, baseline, diff, config) => {
	return new Promise((resolve, reject) => {
		try {
			const actualPng = PNG.sync.read(fs.readFileSync(actual));
			const baselinePng = PNG.sync.read(fs.readFileSync(baseline));
			const { width, height } = actualPng;
			const diffPng = new PNG({ width, height });

			let threshold = config.settings && config.settings.threshold ? config.settings.threshold : 0.05;
			let tolerance = config.settings && config.settings.tolerance ? config.settings.tolerance : 0;

			let numDiffPixels = pixelmatch(actualPng.data, baselinePng.data, diffPng.data, width, height, {
				threshold: threshold
			});

			if (numDiffPixels > tolerance) {
				fs.writeFileSync(diff, PNG.sync.write(diffPng));
				resolve({ status: 'failed', numDiffPixels: numDiffPixels, diffPng: diff });
			} else {
				resolve({ status: 'passed' });
			}
		} catch (error) {
			resolve({ status: 'failed', actual: actual, error: error });
		}
	});
};

const comparePdfByImage = async (actualPdf, baselinePdf, config) => {
	return new Promise(async (resolve, reject) => {
		const imageEngine =
			config.settings.imageEngine === 'graphicsMagick'
				? require('./engines/graphicsMagick')
				: require('./engines/native');

		const actualPdfBaseName = path.parse(actualPdf).name;
		const baselinePdfBaseName = path.parse(baselinePdf).name;

		const actualPngDirPath = `${config.paths.actualPngRootFolder}/${actualPdfBaseName}`;
		utils.ensureAndCleanupPath(actualPngDirPath);
		const actualPngFilePath = `${actualPngDirPath}/${actualPdfBaseName}.png`;

		const baselinePngDirPath = `${config.paths.baselinePngRootFolder}/${baselinePdfBaseName}`;
		utils.ensureAndCleanupPath(baselinePngDirPath);
		const baselinePngFilePath = `${baselinePngDirPath}/${baselinePdfBaseName}.png`;

		const diffPngDirPath = `${config.paths.diffPngRootFolder}/${actualPdfBaseName}`;
		utils.ensureAndCleanupPath(diffPngDirPath);

		await imageEngine.pdfToPng(actualPdf, actualPngFilePath, config);
		await imageEngine.pdfToPng(baselinePdf, baselinePngFilePath, config);

		let actualPngs = fs
			.readdirSync(actualPngDirPath)
			.filter((pngFile) => path.parse(pngFile).name.startsWith(actualPdfBaseName));
		let baselinePngs = fs
			.readdirSync(baselinePngDirPath)
			.filter((pngFile) => path.parse(pngFile).name.startsWith(baselinePdfBaseName));

		if (config.settings.matchPageCount === true) {
			if (actualPngs.length !== baselinePngs.length) {
				resolve({
					status: 'failed',
					message: `Actual pdf page count (${actualPngs.length}) is not the same as Baseline pdf (${baselinePngs.length}).`
				});
			}
		}

		let comparisonResults = [];
		for (let index = 0; index < baselinePngs.length; index++) {
			let suffix = '';
			if (baselinePngs.length > 1) {
				suffix = `-${index}`;
			}

			let actualPng = `${actualPngDirPath}/${actualPdfBaseName}${suffix}.png`;
			let baselinePng = `${baselinePngDirPath}/${baselinePdfBaseName}${suffix}.png`;
			let diffPng = `${diffPngDirPath}/${actualPdfBaseName}_diff${suffix}.png`;

			if (config.skipPageIndexes && config.skipPageIndexes.length > 0) {
				if (config.skipPageIndexes.includes(index)) {
					continue;
				}
			}

			if (config.onlyPageIndexes && config.onlyPageIndexes.length > 0) {
				if (!config.onlyPageIndexes.includes(index)) {
					continue;
				}
			}

			if (config.masks) {
				let pageMasks = _.filter(config.masks, { pageIndex: index });
				if (pageMasks && pageMasks.length > 0) {
					for (const pageMask of pageMasks) {
						await imageEngine.applyMask(actualPng, pageMask.coordinates, pageMask.color);
						await imageEngine.applyMask(baselinePng, pageMask.coordinates, pageMask.color);
					}
				}
			}

			if (config.crops) {
				let pageCroppings = _.filter(config.crops, { pageIndex: index });
				if (pageCroppings && pageCroppings.length > 0) {
					for (const pageCrop of pageCroppings) {
						await imageEngine.applyCrop(actualPng, pageCrop.coordinates);
						await imageEngine.applyCrop(baselinePng, pageCrop.coordinates);
					}
				}
			}

			comparisonResults.push(await comparePngs(actualPng, baselinePng, diffPng, config));
		}

		if (config.settings.cleanPngPaths) {
			utils.ensureAndCleanupPath(config.paths.actualPngRootFolder);
			utils.ensureAndCleanupPath(config.paths.baselinePngRootFolder);
		}

		const failedResults = _.filter(comparisonResults, (res) => res.status === 'failed');
		if (failedResults.length > 0) {
			resolve({
				status: 'failed',
				message: `${actualPdfBaseName}.pdf is not the same as ${baselinePdfBaseName}.pdf compared by their images.`,
				details: failedResults
			});
		} else {
			resolve({ status: 'passed' });
		}
	});
};

module.exports = {
	comparePngs,
	comparePdfByImage
};

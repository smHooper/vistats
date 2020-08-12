

var SUMMER_MONTHS = ['may', 'jun', 'jul', 'aug', 'sep'];

var QUERY_INFO = {};
var QUERY_DATA = {};
var CHART;

function queryDB(sql, dbName) {

	return $.ajax({
		url: 'vistats.php',
		method: 'POST',
		data: {action: 'query', queryString: sql, db: dbName},
		cache: false
	});

}


function getPivotColumns() {

	const startDate = new Date(`${$('#input-start_date').val()} 00:00`);//need to initalize with time otherwise the time is set as 11:59 of the day (i.e., month) before
	const endDate = new Date(`${$('#input-end_date').val()} 00:00`);
	const timeStep = $('#select-time_step').val();

	var columns = [];
	var currentDate = startDate;
	while (currentDate <= endDate) {
		let currentColumn = currentDate.getFullYear().toString();
		if (timeStep === 'month') {
			currentColumn += `_${currentDate.toLocaleString('default', {month: 'short'}).toLowerCase()}`
		}
		if (!columns.includes(currentColumn)) columns.push(currentColumn);
		currentDate = new Date(currentDate.setMonth(currentDate.getMonth() + 1));

	}

	return columns;
}


function getMaxXLabels(minSpacing=45) {

	return Math.round($('#chart').width() / minSpacing);

}


function getChartType(labels) {

	var chartType = $('#select-chart_type').val();
	var groups = [];
	if (chartType === 'stacked bar') {
		chartType = 'bar';
		groups = [labels];
	}

	return [chartType, groups];

}


function createPlot(data, labels, colors, chartType, groups=[]) {

	CHART = c3.generate({
		bindto: '#chart',
		data: {
			x: 'x',
			columns: data,
			type: chartType,
			groups: groups,//[labels],
			colors: colors,
			order: null
		},
		legend: {
			show: false
		},
	    axis : {
	        x: {
	        	type: 'category',
	            tick: {
	            	rotate: -45,
	                multiline: false,
	                culling: {max: getMaxXLabels()},
	                outer: false
	            }
	        },
	        y: {
	            tick: {
	                outer: false
	            }
	        }
	    }
	});

	function toggle(id) {
	    CHART.toggle(id);
	}

}


function reloadPlot(data, chartType, groups=[]) {

	if (CHART.internal.config.data_type !== chartType) CHART.unload();

	CHART.load({
		columns: data,
		type: chartType
	})
	CHART.groups(groups);
}


function loadLegend(labels, chartType){

	// Clear the legend
	d3.selectAll('.legend-item-container').remove();

	// Add containers for each legend item and bind events to them
	var legendItems = d3.select('.legend-body')
		.selectAll('span')
		.data([...labels].reverse())
		.enter().append('div').attr('class', 'legend-item-container')
		.on('mouseover', function(id) {
			CHART.focus(id);//
		})
		.on('mouseout', function(id) {
			CHART.revert(); //
		})
	
	// Add the patches
	var legendPatches = legendItems.append('div').attr('class', 'legend-patch');
	if (chartType === 'line') {
		const bbox = legendPatches.node().getBoundingClientRect();
		legendPatches
			.each(function(id) {
				const svgY = bbox.height / 2;
				const thisColor = CHART.color(id);
				var svg = d3.select(this)
					.append('svg')
					.attr('width', bbox.width)
					.attr('height', bbox.height);
				svg.append('line')
					.attr('x1', 0)
					.attr('y1', svgY)
					.attr('x2', bbox.width)
					.attr('y2', svgY)
					.style('stroke', thisColor)
				svg.append('circle')
					.attr('cx', 2)
					.attr('cy', svgY)
					.attr('r', 2)
					.style('fill', thisColor);
				svg.append('circle')
					.attr('cx', bbox.width - 2)
					.attr('cy', svgY)
					.attr('r', 2)
					.style('fill', thisColor)
			});
	} else {
		legendPatches.each(function(id) {
			d3.select(this).style('background-color', CHART.color(id));
		})
	}
	// Add the labels
	legendItems.insert('label').attr('class', 'legend-label')
		.attr('data-id', function(id) {
			return id;
		})
		.text(function(id) {
			return id;
		}
	);

}


function getOptions() {

	const startDate = new Date($('#input-start_date').val() + ' 00:00');
	const endDate = new Date($('#input-end_date').val() + ' 00:00');
	
	return {
		query: 		{id: '#select-query', value: $('#select-query').val() },
		timeStep: 	{id: '#select-time_step', value: $('#select-time_step').val() },
		startDate:	{id: '#input-start_date', value: `${startDate.getFullYear()}-${('0' + (startDate.getMonth() + 1)).slice(-2)}` },
		endDate: 	{id: '#input-end_date', value: `${endDate.getFullYear()}-${('0' + (endDate.getMonth() + 1)).slice(-2)}` },
		chartType: 	{id: '#select-chart_type', value: $('#select-chart_type').val() },
		grid: 		{id: '#checkmark-grid', value: $('#checkmark-grid').prop('checked') },
		multiplier: {id: '#checkmark-multiplier', value: $('#checkmark-multiplier').prop('checked')}
	}
}


function plotData(data, labels, pivotColumns, colors) {


	let xTickLabels = [];
	for (i in pivotColumns) {
		let [year, month] = pivotColumns[i].split('_');
		const label = $('#select-time_step').val() == 'month' ?  `${month[0].toUpperCase()}${month.slice(1,3)}, ${year}` : year;
		xTickLabels.push(label);
	}

	var [chartType, groups] = getChartType(labels);

	// If the CHART is not yet defined, create it
	data = [['x'].concat(xTickLabels)].concat(data);
	if (CHART === undefined) {
		createPlot(data, labels, colors, chartType, groups);
	} else {
		reloadPlot(data, chartType, groups);
	}

	loadLegend(labels, chartType);

	// Create title
	var formatter = new Intl.DateTimeFormat('en', {month: 'long'});
	const startDate = new Date($('#input-start_date').val() + ' 00:00');
	const endDate =   new Date($('#input-end_date').val() + ' 00:00');

	$('.chart-title').text(`${$('#select-query').val()}: ${formatter.format(startDate)}, ${startDate.getFullYear()}—${formatter.format(endDate)}, ${endDate.getFullYear()}`);

	const cookieData = {
		data: data.slice(1),
		labels: labels,
		pivotColumns: pivotColumns,
		colors: colors,
		options: getOptions()
	};

	setCookie('plot-data', JSON.stringify(cookieData), 60);

	hideLoadingIndicator();
}


function plotDataFromCookie(cookieData) {

	for (key in cookieData.options) {
		const option = cookieData.options[key];
		if (option.id.startsWith('#checkmark')) {
			$(option.id).prop('checked', option.value);
		} else {
			$(option.id).val(option.value);
		}
	}
	plotData(cookieData.data, cookieData.labels, cookieData.pivotColumns, cookieData.colors);
}


function onPlottingOptionChange(optionElementID) {
	
	// Get data from cookie
	const cookieData = $.parseJSON(getCookie('plot-data'));
	
	// Update cookie data with new option value
	var cookieDataOptions = cookieData.options;
	for (optionName in cookieDataOptions) {
		const thisOption = cookieDataOptions[optionName];
		if (optionElementID === thisOption.id) {
			cookieData.options[optionName].value = optionElementID.startsWith('#checkmark') ?
				$(optionElementID).prop('checked') :
				$(optionElementID).val();
		}
	}
	
	// plot
	plotDataFromCookie(cookieData);

}

function resizeLayout() {
	const $container = $('.chart-container');
	const $title = $('.chart-title');
	CHART.resize({
		height: $container.height() - $title.css('height').replace('px', ''),
		width: $container.width()
	});
}


function queryIRMA(pivotColumns, fieldIDStr) {
	/*
	Helper function to actually query the IRMA STATS db
	*/

	const startDate = new Date(`${$('#input-start_date').val()} 00:00`);
	const endDate = new Date(`${$('#input-end_date').val()} 00:00`);
	// All IRMA dates are the first of the month so make sure the end date is after the first of the 
	//	month to make sure it includes the endDate selected by the user
	const dateStr = `BETWEEN '${startDate.getFullYear()}-${startDate.getMonth() + 1}-1' AND '${endDate.getFullYear()}-${endDate.getMonth() + 1}-2'`;
	const timeStep = $('#input-time_step');

	const pivotColumnStr = `[${pivotColumns.join('], [')}]`;

	var sql = `
		SELECT *
		FROM
			(SELECT 
				Field_Name AS field_id,
				value AS data_value,
				lower(format(value_date, 'yyyy_MMM')) value_month
			FROM
				(SELECT 
					Field_Name, 
					${(timeStep === 'year') ? 'sum(Calculated_Value)' : 'Calculated_Value'} AS value,
					CV_Collected_Date AS value_date
				FROM VIEW_DENA_FieldsAndValues 
				WHERE 
					Field_Name IN (${fieldIDStr}) AND
					Calculated_Value IS NOT NULL AND
					CV_Collected_Date ${dateStr}
				UNION ALL 
				SELECT 
					Field_Name, 
					Field_Name_Value AS value,
					FNV_Collected_Date AS value_date 
				FROM VIEW_DENA_FieldsAndValues 
				WHERE 
					Field_Name IN (${fieldIDStr}) AND
					Field_Name_Value IS NOT NULL AND
					FNV_Collected_Date ${dateStr}
				) t
			) t1
		PIVOT (
			sum(data_value)
			FOR value_month IN (${pivotColumnStr})
		) AS p
	`;

	var deferred = queryDB(sql, 'irma')
		.then(
			doneFilter=function(queryResultString){
				if (queryResultString.startsWith('ERROR') || queryResultString === '["query returned an empty result"]') { 
					console.log(`error getting query parameters: ${queryResultString}`);
				} else {
					const queryResult = $.parseJSON(queryResultString);
					QUERY_DATA = {}; // reset
					for (id in QUERY_INFO){
						const thisInfo = QUERY_INFO[id];
						// Find the data row for this row in the queryInfo by comparing field IDs
						let row;
						for (i in queryResult) {
							row = queryResult[i];
							if (thisInfo.field_id === row.field_id) {
								break;
							}
						} 

						thisRow = [];
						theseMultipliers = []; // Since multipliers differ per month, collect an array to apply to each element of the data array
						var isModifier = false;
						for (i in pivotColumns) {
							const columnName = pivotColumns[i];
							const month = columnName.split('_')[1];
							const multiplier = SUMMER_MONTHS.includes(month) ? thisInfo.summer_multiplier : thisInfo.winter_multiplier;
							theseMultipliers.push(multiplier);
							// Only apply the multiplier if these data should be subtracted. Other multipliers will be 
							//	applied on the fly depending on whether the user has that option checked
							if (thisInfo.field_to_modify !== null) {
								const thisVal = Math.round(row[columnName] * multiplier);	
								if (!isModifier) isModifier = true;//if it's already marked as true, keep it as true
								thisRow.push(thisVal);
							} else {
								thisRow.push(row[columnName]);
							}
						}

						const thisID = isModifier ? thisInfo.field_to_modify : thisInfo.id

						// Add the object if it doesn't already exists in the QUERY_DATA object and this isn't a modifier array
						if (!Object.keys(QUERY_DATA).includes(thisID)) {
							QUERY_DATA[thisID] = {
								modifyBy: [] //array of arrays of values to subtract from data
								// all otherproperties get assigned in the else {} closure below
							}; 
						}	

						if (isModifier) {
							QUERY_DATA[thisID].modifyBy.push(thisRow);
						} else {
							QUERY_DATA[thisID].data = thisRow;
							QUERY_DATA[thisID].multipliers = theseMultipliers;
							QUERY_DATA[thisID].label = thisInfo.label;
							QUERY_DATA[thisID].color = thisInfo.color;
							QUERY_DATA[thisID].sortOrder = thisInfo.sort_order;
						}

					};

					// First loop through QUERY_DATA and sort IDs by their .sort_order
					var sortOrder = [];
					for (id in QUERY_DATA) {
						sortOrder[QUERY_DATA[id].sortOrder] = id;
					}

					var chartData = [];
					var chartLabels = [];
					var chartColors = {};
					// Then, loop through QUERY_DATA and subtract as necessary
					for (s in sortOrder){
						const id = sortOrder[s];
						let data = QUERY_DATA[id];
						// data.modifyBy is an array of arrays with length data.length, so loop through each individual array and 
						for (i in data.modifyBy) {
							const theseModifierValues = data.modifyBy[i];
							for (j in theseModifierValues) {
								data.data[j] += theseModifierValues[j]; // negative multiplier already applied so add to the value
							}
						}

						// If multiplier is checked, adjust data by the multiplier per month
						if ($('#checkmark-multiplier').prop('checked')) {
							for (i in data.data) {
								data.data[i] = Math.round(data.data[i] * data.multipliers[i]);
							}
						}

						chartData.push([data.label].concat(data.data));
						chartLabels.push(data.label);
						chartColors[data.label] = data.color;
					}

					// then loop through again and compose chartData
					plotData(chartData, chartLabels, pivotColumns, chartColors);
				}
			}, 
			failFilter=function(xhr, status, error) {
				alert(`configuring form failed with status ${status} because ${error} with query:\n${sql}`);
				hideLoadingIndicator();
			}
		);

	return deferred
}

function runQuery(){

	const pivotColumns = getPivotColumns();
	const queryName = $('#select-query').val();

	showLoadingIndicator();

	var fields;
	const sql = `
		SELECT irma_query_names.name, irma_query_info.* 
		FROM irma_query_names 
		INNER JOIN irma_query_info ON irma_query_names.id=irma_query_info.query_id 
		WHERE irma_query_names.name='${queryName}'
		ORDER BY sort_order
	;`;
	var deferred = queryDB(sql, 'vistats');
	deferred.then(
		doneFilter=function(queryResultString){
			queryResultString = queryResultString.trim();
			if (queryResultString.startsWith('ERROR') || queryResultString === '["query returned an empty result"]') { 
				console.log(`error getting query parameters: ${queryResultString}`);
			} else { 
				let queryResult = $.parseJSON(queryResultString);
				let fieldIDs = [];
				queryResult.forEach(function(queryRow){
					fieldIDs.push(queryRow.field_id);
				})
				fields = `'${fieldIDs.join("', '")}'`;
				queryResult.forEach(function(row) {
					// Field iDs could repeat within the same query so use the database ID as the key
					QUERY_INFO[row.id] = {...row};
				});
				
			}
		},
		failFilter=function(xhr, status, error) {
			alert(`configuring form failed with status ${status} because ${error} with query:\n${sql}`);
			hideLoadingIndicator();
		}
	).then(
		doneFilter=() => {queryIRMA(pivotColumns, fields)}
	);
}
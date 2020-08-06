

var SUMMER_MONTHS = ['may', 'jun', 'jul', 'aug', 'sep'];

var QUERY_INFO = {};
var QUERY_DATA = {};

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


function plotData(data, labels, pivotColumns, colors) {


	let xTickLabels = [];
	for (i in pivotColumns) {
		let [year, month] = pivotColumns[i].split('_');
		const label = $('#select-time_step').val() == 'month' ?  `${month[0].toUpperCase()}${month.slice(1,3)}, ${year}` : year;
		xTickLabels.push(label);
	}

	var chart = c3.generate({
		bindto: '#chart',
		data: {
			columns: data,
			type: 'bar',
			groups: [labels],
			colors: colors,
			order: null
		},
		legend: {
			show: false
		},
    axis : {
        x: {
        	type: 'category',
            categories: xTickLabels,
            tick: {
            	rotate: -45,
                multiline: false
            }
        }
    }
	});

	function toggle(id) {
	    chart.toggle(id);
	}

	// Clear the legend
	d3.selectAll('.legend-item-container').remove();

	// Add containers for each legend item and bind events to them
	var legendItems = d3.select('.legend-body')
		.selectAll('span')
		.data(labels.reverse())
		.enter().append('div').attr('class', 'legend-item-container')
		.on('mouseover', function(id) {
			chart.focus(id);
		})
		.on('mouseout', function(id) {
			chart.revert();
		})
	// Add the patches
	legendItems.append('div').attr('class', 'legend-patch')
		.each(function(id) {
			d3.select(this).style('background-color', chart.color(id));
		})
	// Add the labels
	legendItems.insert('label').attr('class', 'legend-label')
		.attr('data-id', function(id) {
			return id;
		})
		.text(function(id) {
			return id;
		}
	);

	$('#legend-container').css('height', $('#chart').css('height'));

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
				console.log(`configuring form failed with status ${status} because ${error} with query:\n${sql}`)
			}
		);

	return deferred
}

function runQuery(){

	const pivotColumns = getPivotColumns();
	const queryName = $('#select-query').val();


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
			console.log(`configuring form failed with status ${status} because ${error} with query:\n${sql}`)
		}
	).then(
		doneFilter=() => {queryIRMA(pivotColumns, fields)}
	);
}
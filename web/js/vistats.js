

USER_ROLES = {}
COUNT_PERIODS = {}; // stores id, count_date from count_periods table
DATA = {}; // stores queried data

function queryDB(sql) {


	var deferred = $.ajax({
		url: 'vistats.php',
		method: 'POST',
		data: {action: 'query', queryString: sql},
		cache: false
	});

	return deferred;
}


function getMostRecentPeriodDate() {

	const now = new Date();
	const currentMonth = now.getMonth() + 1;
	if (currentMonth == 1) {
		var periodYear = now.getFullYear() - 1;
		var periodMonth = 12;
	} else {
		var periodYear = now.getFullYear();
		var periodMonth = currentMonth - 1;
	}

	return new Date(`${periodYear}-${periodMonth}-1`);
}


function getFormattedTimestamp(date=undefined) {

	if (date === undefined) date = new Date();

	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`;

}


function onVerifyAllClick(event) {

	// prevent the form from resetting
	event.returnValue = false;
	const username = $('#username').text()

	var nCheckboxes = $('.verified-checkbox').length
	var nCheckboxesChecked = $('.verified-checkbox:checked').length
	if (nCheckboxesChecked < nCheckboxes) {
		let notChecked = $('.verified-checkbox').not(':checked')
		let notCheckedLabels = notChecked.closest('tr').children('.verified-by-label')
		$('.verified-checkbox').prop('checked', true);
		$('#verify-all-button').text('unselect all')
		notCheckedLabels.text(username)
	} else {
		// Check if anything has been verified by another user
		var verifiedByOther = false;
		$('.verified-by-label').each(function(){
			let thisUsername = $(this).text()
			verifiedByOther = thisUsername !== '' && thisUsername !== username;
		})
		// If so, check that the user really wants to unverify all of them
		let unselectConfirmed = verifiedByOther ? 
			confirm('There are some values that have been verified by another user. Are you sure you want to mark them all as unverified?') :
			true;
		if (unselectConfirmed) {
			$('.verified-checkbox').prop('checked', false);
			$('#verify-all-button').text('verify all');
			$('.verified-by-label').text('')
		}
	}
}


// Cusotm jquery selector to find items assigned to the current user
$.expr[':'].hasTag = function(jqObject) {
	const roles = USER_ROLES[$('#username').text()]
	
	const hasTag = roles.includes($(jqObject).attr('data-source-tag')) || roles.includes('admin');

	return hasTag;
}


function getUserRoles(username) {

	let deferred = $.ajax({
		url: 'vistats.php',
		method: 'POST',
		data: {action: 'getUserRoles'},
		cache: false
	})
	
	return deferred;
}


function configureForm(periodDate=null) {

	$('#input-table > tbody').empty()

	if (periodDate === null) periodDate = getMostRecentPeriodDate();
	const periodMonth = periodDate.getMonth() + 1

	var currentUser = $('#username').text();

	if (USER_ROLES[currentUser] === undefined) {
		alert(`You are currently logged in as '${currentUser}', but this user does not have any Visitor Use Stat roles assigned. Either log into your computer as a different user and re-load this webpage or contact the site administrator.`)
		return;
	}

	const sql = `
		SELECT 
			value_labels.id,
			value_labels.dena_label,
			value_labels.retrieve_data_label,
			value_labels.is_summer,
			value_labels.is_winter,
			value_labels.irma_html_element_id,
			value_labels.source_tag,
			counts.value,
			counts.last_edited_by,
			counts.last_edit_time,
			counts.verified,
			counts.verified_by,
			counts.verified_time,
			counts.is_estimated,
			counts.count_date,
			counts.period_id
		FROM 
			value_labels LEFT JOIN 
				(
					SELECT * FROM counts INNER JOIN count_periods ON count_periods.id = counts.period_id 
					WHERE 
						extract(year FROM count_periods.count_date) = ${periodDate.getFullYear()} AND 
						extract(month FROM count_periods.count_date) = ${periodMonth}
				) AS counts
				ON value_labels.id = counts.value_label_id 
		ORDER BY id;
	`
	let deferred = queryDB(sql)
	deferred.then(
		doneFilter=function(queryResultString){
			if (queryResultString.startsWith('ERROR') || queryResultString === '["query returned an empty result"]') { 
				console.log(`error configuring main form: ${queryResultString}`);
			} else {  
				let queryResult = $.parseJSON(queryResultString);
				if (queryResult) {
					queryResult.forEach(function(object) {
						DATA[object.id] = {...object}
						var seasonClass = '';
						if (object.is_winter === 't') seasonClass += ' winter-field';
						if (object.is_summer === 't') seasonClass += ' summer-field';
						let isVerified = object.verified === 't' ? 'checked="checked"' : ''
						let isEstimated = object.is_estimated === 't' ? 'checked="checked"' : ''
						$(`
						<tr class="data-input-row ${seasonClass} hidden" id="data-row-${object.retrieve_data_label}" data-label-id=${object.id} data-source-tag=${object.source_tag}>
							<td class="data-input-label left-align">${object.dena_label}</td>
							<td><input class="data-input" type="number" id="input-${object.retrieve_data_label}" min="0" requried value=${object.value} data-irma-element=${object.irma_html_element_id}></td>
							<td>
								<label class="checkmark-container">
									<input class="input-checkbox" type="checkbox" ${isEstimated} id="checkbox-estimated-${object.retrieve_data_label}">
									<span class="checkmark data-input-checkmark"></span>
								</label>
							</td>
							<td>
								<label class="checkmark-container">
									<input class="input-checkbox verified-checkbox" type="checkbox" ${isVerified} id="checkbox-verified-${object.retrieve_data_label}">
									<span class="checkmark data-input-checkmark"></span>
								</label>
							</td>
							<td class="data-input-label verified-by-label">${object.verified === 't' && object.verified_by != null ? object.verified_by : ''}</td>
						</tr>`).appendTo('#input-table > tbody')
					
						$(`#input-${object.retrieve_data_label}`).change(()=> {onDataInputChange(`input-${object.retrieve_data_label}`)})
						$(`#checkbox-verified-${object.retrieve_data_label}`).change(()=> {onVerifiedCheckboxChange(object.retrieve_data_label)})
						$(`#checkbox-estimated-${object.retrieve_data_label}`).change(()=> {onEstimatedCheckboxChange(object.retrieve_data_label)})//
					})
				} 
			}

			if (periodMonth >=5 && periodMonth <=9) {
				$('.summer-field').removeClass('hidden')
			} else {
				$('.winter-field').removeClass('hidden')
			}

			// This button is hidden at first because loading the data takes a minute
			//	 and it doesn't make sense to show it before then
			$('#verify-all-button').removeClass('hidden');

			$('.data-input-row').not(':hasTag').addClass('hidden');

			if (!USER_ROLES[currentUser].includes('admin')) $('#fill-stats-button').addClass('hidden')

			// Remove any hidden rows from the DOM
			$('.data-input-row.hidden').remove();

			// When the user checks the 
			//$('.verified-checkbox').change(()=>{$(this).closest('tr').find('.verified-by-label').val(currentUser)})


		},
		failFilter=function(xhr, status, error) {
			console.log(`configuring form failed with status ${status} because ${error} with query:\n${sql}`)
		}
	)

	return deferred
}


function onMonthSelectChange() {
	showLoadingIndicator();
	const dateString = COUNT_PERIODS[$('#month-select').val()]
	const periodDate = new Date(dateString + 'T12:00:00.000-08:00');
	configureForm(periodDate)
		.then(hideLoadingIndicator());
}


function userDidEdit(thisID){
	DATA[thisID].last_edited_by = $('#username').text();
	DATA[thisID].last_edit_time = getFormattedTimestamp();
}


function onDataInputChange(inputID) {
	/*If this value has already been verified (by someone else), confirm the change*/

	const thisInput = $('#' + inputID);
	const parentRow = thisInput.closest('tr');
	const verifiedCheckbox = parentRow.find('.verified-checkbox');
	const verifiedBy = parentRow.find('.verified-by-label').text();
	if (verifiedCheckbox.prop('checked') && verifiedBy !== $('#username').text()) {
		let commitChange = confirm(`Are you sure you want to change this value? It was already verified by ${verifiedBy}`);
		if (commitChange) {
			let thisID = parentRow.attr('data-label-id')
			DATA[thisID].value = thisInput.val();
			DATA[thisID].verified = false;
			DATA[thisID].verified_by = null;
			DATA[thisID].verified_time = null;
			userDidEdit(thisID);
			parentRow.find('.verified-by-label').text('');
			verifiedCheckbox.prop('checked', false);
		} else {
			thisInput.val(DATA[parentRow.attr('data-label-id')].value);
		}
	}
}


function onVerifiedCheckboxChange(labelName) {
	/*When the user checks an uncheck verified-by checkbox, add their name and update related fields*/
	let thisCheckbox = $('#checkbox-verified-' + labelName);
	let thisID = thisCheckbox.closest('tr').attr('data-label-id')
	if (thisCheckbox.prop('checked')) {
		let username = $('#username').text();
		$('#data-row-' + labelName).find('.verified-by-label').text(username);
		DATA[thisID].verified = true;
		DATA[thisID].verified_by = username;
		DATA[thisID].verified_time = getFormattedTimestamp();
		userDidEdit(thisID)
	} else {
		$('#data-row-' + labelName).find('.verified-by-label').text('');
		DATA[thisID].verified = false;
		DATA[thisID].verified_by = null;
		DATA[thisID].verified_time = null;
		userDidEdit(thisID)
	}

}


function onEstimatedCheckboxChange(labelName) {
	let thisCheckbox = $('#checkbox-estimated-' + labelName)
	let thisID = thisCheckbox.closest('tr').attr('data-label-id')
	DATA[thisID].is_estimated = thisCheckbox.prop('checked')
}



function onSaveClick(event) {
	
	showLoadingIndicator();

	event.returnValue = false;

	var sqlStatements = [];
	var sqlParameters = []
	$('.data-input-row').each(function() {
		const thisID = $(this).attr('data-label-id');
		const thisObj = DATA[thisID];
		let dataValue = thisObj.value;
		// If there's no data value in the DATA object, a row for this field doesn't exisit in the DB
		if (dataValue === null || dataValue === undefined || dataValue === '') {
			dataValue = $(this).val();
			
			if (dataValue == "") return; // If the user hasn't entered anything in the app either, skip it
			
			sqlStatements.push(
				`INSERT INTO counts 
					(value_label_id, value, period_id, entered_by, submission_time, verified, verified_by, verified_time, is_estimated) 
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`
			)
			sqlParameters.push([thisID, , thisObj.period_id, thisObj.entered_by, getFormattedTimestamp(), thisObj.verified, thisObj.verified_by, thisObj.verified_time, thisObj.is_estimated])
		} else {
			sqlStatements.push(
				`UPDATE counts SET 
					value_label_id=$1,
					value=$2,
					period_id=$3,
					last_edited_by=$4,
					last_edit_time=$5,
					verified=$6,
					verified_by=$7,
					verified_time=$8,
					is_estimated=$9
				WHERE 
					period_id=${thisObj.period_id} AND
					value_label_id=${thisID}
				`
			)
			sqlParameters.push([thisID, dataValue, thisObj.period_id, thisObj.last_edited_by, thisObj.last_edit_time, thisObj.verified, thisObj.verified_by, thisObj.verified_time, thisObj.is_estimated])
		}
	})

	$.ajax({
        url: 'vistats.php',
        method: 'POST',
        data: {action: 'paramQuery', queryString: sqlStatements, params: sqlParameters},
        cache: false
	}).then(
    	function(queryResultString){
        	let resultString = queryResultString.trim();
        	if (resultString.startsWith('ERROR') || resultString === "false") {
        		alert('Unabled to save changes to the database. ' + resultString);
        		return false; // Save was unsuccessful
        	} else {
        		return true; // Save was successful
        	}
        	hideLoadingIndicator();
        }
	)
}

function fillSelectOptions(selectElementID, queryString, optionClassName='') {
    
	let deferred = queryDB(queryString)
	deferred.then(
		doneFilter=function(queryResultString){
            var queryResult = queryResultString.startsWith('ERROR') || queryResultString === '["query returned an empty result"]' ? 
            	false : $.parseJSON(queryResultString);
            if (queryResult) {
                queryResult.forEach(function(object) {
                    $('#' + selectElementID).append(
                        `<option class="${optionClassName}" value="${object.value}">${object.name}</option>`
                    );
                })
            } else {
                console.log(`error filling in ${selectElementID}: ${queryResultString}`);
            }
        },
        failFilter=function(xhr, status, error) {
            console.log(`fill select failed with status ${status} because ${error} from query:\n${sql}`)
        }
    );

    return deferred;
}


function showLoadingIndicator() {

	//set a timer to turn off the indicator after a max of 15 seconds because 
	//  sometimes hideLoadingIndicator doesn't get called or there's some mixup 
	//  with who called it
	setTimeout(hideLoadingIndicator, 15000);

	var thisCaller = showLoadingIndicator.caller.name;

	var indicator = $('#loading-indicator').css('display', 'block')
	$('#loading-indicator-background').css('display', 'block');

	// check the .data() to see if any other functions called this
	indicator.data('callers', indicator.data('callers') === undefined ? 
		[thisCaller] : indicator.data('callers').concat([thisCaller])
	)

}


function hideLoadingIndicator(caller) {
	

	var indicator = $('#loading-indicator')
	// if no caller was given, just remove the indicator
	if (caller === undefined) {
		 indicator.data('callers', [])
	} else if (indicator.data('callers').includes(caller)) {
		indicator.data(
			'callers', 
			indicator.data('callers').filter(thisCaller => thisCaller != caller)
		);
	}

	// Hide the indicator if there are no more callers
	if (!indicator.data('callers').length) {
		$('#loading-indicator-background').css('display', 'none');
		indicator.css('display', 'none');
	}

}
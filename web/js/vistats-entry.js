

var USER_ROLES = {}
var COUNT_PERIODS = {}; // stores id, count_date from count_periods table
var DATA = {}; // stores queried data
var CURRENT_DATE = '1970-1-1';
var UNDO_BUFFER = {};

function queryDB(sql) {


	var deferred = $.ajax({
		url: 'vistats.php',
		method: 'POST',
		data: {action: 'query', queryString: sql, db: 'vistats'},
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


function getFormattedTimestamp(date) {

	if (date === undefined) date = new Date();

	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`;

}


function onVerifyAllClick(event) {

	// prevent the form from resetting
	event.returnValue = false;
	const username = $('#username').text();

	// If any data fields are blank, as the user if they want to set them to 0
	const missingVals = $('.data-input').filter(function() {return !$(this).hasClass('hidden') && $(this).val() === ""});
	if (missingVals.length) {
		const setTo0 = window.confirm(`1 or more fields that you're marking as confirmed are currently blank. Do you want to set them all to 0 or cancel verifying all values?`)
		if (setTo0) {
			missingVals.val(0).change() // set to 0 and record vals in DATA object
		} else {
			return;
		}
	}	

	var visibleCheckboxes = $('.verified-checkbox').filter(function() {return !$(this).closest('.data-input-row').hasClass('hidden')});
	var nCheckboxes = visibleCheckboxes.length;
	var nCheckboxesChecked = visibleCheckboxes.filter(':checked').length;

	if (nCheckboxesChecked < nCheckboxes) {
		let notChecked = visibleCheckboxes.not(':checked');
		let notCheckedLabels = notChecked.closest('.data-input-row').children('.verified-by-label');
		notCheckedLabels.text(username);
		visibleCheckboxes
			.prop('checked', true)
			.change();
		$('#verify-all-button').text('unselect all');
	} else {
		// Check if anything has been verified by another user
		var verifiedByOther = false;
		$('.verified-by-label').filter(function() {return !$(this).closest('.data-input-row').hasClass('hidden')})
			.each(function(){
				let thisUsername = $(this).text();
				verifiedByOther = verifiedByOther ? true : thisUsername !== '' && thisUsername !== username;
			})
		// If so, check that the user really wants to unverify all of them
		let unselectConfirmed = verifiedByOther ? 
			window.confirm('There are some values that have been verified by another user. Are you sure you want to mark them all as unverified?') :
			true;
		if (unselectConfirmed) {
			visibleCheckboxes.prop('checked', false);
			$('#verify-all-button').text('verify all');
			visibleCheckboxes.closest('.data-input-row').find('.verified-by-label').text('')
		}
	}
}


// Cusotm jquery selector to find items assigned to the current user
$.expr[':'].hasTag = function(jqObject) {
	const roles = USER_ROLES[$('#username').text()];
	
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


function setVerifyAllButtonText() {
	
	var visibleCheckboxes = $('.verified-checkbox').filter(function() {return !$(this).closest('.data-input-row').hasClass('hidden')});
	var nCheckboxes = visibleCheckboxes.length;
	var nCheckboxesChecked = visibleCheckboxes.filter(':checked').length;
	if (nCheckboxesChecked < nCheckboxes) {
		$('#verify-all-button').text('verify all');
	} else {
		$('#verify-all-button').text('unselect all');
	}
}


function resizeColumns() {
	var columnClasses = [];
	$('.data-input-cell').each(function () {
		this.classList.forEach(function(className) {
			if (className.endsWith('column') && !columnClasses.includes(className)) {
				columnClasses.push(className);   
			}
		}) 
	});
	columnClasses.forEach(function(className) {
		let maxWidth = Math.max.apply(Math, $('.' + className).map(function(){return $(this).width()}).get())
		$('.' + className).each((_, el) => {$(el).width(className === 'label-column' ? maxWidth + 20 : maxWidth)});
	})

	resizeFormHeight();
}


function resizeFormHeight() {

	// The body of the form will stretch to the max allowable size, so check 
	const nFields = $('.data-input-row').not('.hidden, .form-data-footer, .form-data-header').length;
	const scrollHeight = nFields * $('.data-input-row').css('height').replace('px', ''); // can't use .scrollHeight prop because it includes all the hidden fields
	const availableSpace = $('#main-container').height() - (
			$('.form-footer').height() + 
			Math.floor($('.form-data-footer').css('height').replace('px', '')) + 
			Math.floor($('.form-data-header').css('height').replace('px', '')) + 
			Math.floor($('.form-header').css('height').replace('px', '')) + 
			Math.floor($('#input-form').css('top').replace('px', ''))
		);

	// The screen has enough space for all of the fields, so let the foot float freely 
	if (scrollHeight <= availableSpace) {
		$('#input-form').removeClass('bottom-pinned');
		$('.form-data-container').removeClass('vertical-scroll');//scroll bar will still show because flexbox adds a tiny fraction to height
	// The screen can't fit everything, so pin the bottom of the form to the bottom of the screen
	} else {
		$('#input-form').addClass('bottom-pinned');
		$('.form-data-container').addClass('vertical-scroll');
	}
}


function configureForm(periodDate) {

	$('#input-table > .form-data-body').empty();

	// If no periodDate was given, get the first date of the current month
	if (periodDate === undefined) periodDate = getMostRecentPeriodDate();

	// Check that periodDate is actually an option to select (retrieve_data.py 
	//	has been run for this month). If it isn't, set the periodDate to the 
	//	most recent option in the dropdown menu
	const periodDateStr = `${periodDate.getFullYear()}-${('0' + (periodDate.getMonth() + 1)).slice(-2)}-01`;
	const dateOptions = $('#month-select')
		.find('.select-option')
		.map((_, el) => {
			return $(el).val();
		})
		.get();
	if (!dateOptions.includes(periodDateStr)) {
		periodDate = new Date(dateOptions[0] + ' 12:00');
	}
	const periodMonth = periodDate.getMonth() + 1;
	
	var currentUser = $('#username').text();

	CURRENT_DATE = $('#month-select').val();

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
			value_labels.irma_field_id,
			value_labels.source_tag,
			counts.value,
			counts.last_edited_by,
			counts.last_edit_time,
			counts.verified,
			counts.verified_by,
			counts.verified_time,
			counts.is_estimated,
			counts.count_date,
			counts.period_id,
			CASE
				WHEN counts.period_id IS NULL THEN 1 
				ELSE 0
			END AS is_new_value
		FROM 
			value_labels LEFT JOIN 
				(
					SELECT * FROM counts INNER JOIN count_periods ON count_periods.id = counts.period_id 
					WHERE 
						extract(year FROM count_periods.count_date) = ${periodDate.getFullYear()} AND 
						extract(month FROM count_periods.count_date) = ${periodMonth}
				) AS counts
				ON value_labels.id = counts.value_label_id 
		WHERE irma_html_element_id IS NOT NULL AND irma_html_element_id <> ''
		ORDER BY sort_order;
	`;
	let deferred = queryDB(sql);
	deferred.then(
		doneFilter=function(queryResultString){
			if (queryResultString.startsWith('ERROR') || queryResultString === '["query returned an empty result"]') { 
				console.log(`error configuring main form: ${queryResultString}`);
			} else {  
				let queryResult = $.parseJSON(queryResultString);
				if (queryResult) {
					var rowIndex = 0;
					queryResult.forEach(function(object) {
						DATA[object.id] = {...object}
						var seasonClass = '';
						if (object.is_winter === 't') seasonClass += ' winter-field';
						if (object.is_summer === 't') seasonClass += ' summer-field';
						let isVerified = object.verified === 't' ? 'checked="checked"' : ''
						let isEstimated = object.is_estimated === 't' ? 'checked="checked"' : ''
						$(`
						<div class="data-input-row ${seasonClass} hidden" id="data-row-${object.retrieve_data_label}" data-label-id=${object.id} data-source-tag=${object.source_tag}>
							<div class="label-column data-input-cell data-input-label left-align">${object.dena_label}</div>
							<div class="input-column data-input-cell">
								<input class="data-input" type="number" id="input-${object.retrieve_data_label}" min="0" requried value=${object.value} data-irma-element=${object.irma_html_element_id} tabindex=${rowIndex * 3 + 1}></div>
							<div class="is-estimated-column data-input-cell">
								<label class="checkmark-container">
									<input class="input-checkbox estimated-checkbox" type="checkbox" ${isEstimated} id="checkbox-estimated-${object.retrieve_data_label}">
									<span class="checkmark data-input-checkmark"></span>
								</label>
							</div>
							<div class="is-verified-column data-input-cell">
								<label class="checkmark-container">
									<input class="input-checkbox verified-checkbox" type="checkbox" ${isVerified} id="checkbox-verified-${object.retrieve_data_label}">
									<span class="checkmark data-input-checkmark"></span>
								</label>
							</div>
							<div class="verified-by-column data-input-cell data-input-label verified-by-label">
								${object.verified === 't' && object.verified_by != null ? object.verified_by : ''}
							</div>
						</div>`).appendTo('#input-table > .form-data-body')
					
						$(`#input-${object.retrieve_data_label}`).change(()=> {onDataInputChange(`input-${object.retrieve_data_label}`)})
						$(`#checkbox-verified-${object.retrieve_data_label}`).change(()=> {onVerifiedCheckboxChange(object.retrieve_data_label)})
						$(`#checkbox-estimated-${object.retrieve_data_label}`).change(()=> {onEstimatedCheckboxChange(object.retrieve_data_label)})//

						rowIndex ++;
					})
				} 
			}

			var season;
			if (periodMonth >= 5 && periodMonth <= 9) {
				$('.summer-field').removeClass('hidden');
				season = 'summer';

				// Show the Upload JV data button if this user has the jv role assigned to them
				if (!USER_ROLES[currentUser].includes('jv')) $('#import-data-button').addClass('hidden');
			
			} else {
				$('.winter-field').removeClass('hidden');
				//$('.generic-button.summer-field').addClass('hidden');
				season = 'winter';
			}

			// Hide any fields that aren't relevant for this user's roles 
			$('.form-data-body > .data-input-row').not(':hasTag').addClass('hidden');

			// If all rows are hidden, this user doesn't have any roles for this season so alert them
			if ($('.form-data-body > .data-input-row').not('.hidden').length === 0) {
				$('.form-footer').addClass('hidden'); // hide the buttons
				alert(`You're logged in as ${username}, but there are no roles assigned to you for the ${season} season.`);
				return; // keep other elements hidden by breaking out of the function
			}

			// This button is hidden at first because loading the data takes a minute
			//	 and it doesn't make sense to show it before then
			$('#verify-all-button').removeClass('hidden');

			// If this is an admin users, un-hide any admin buttons
			if (USER_ROLES[currentUser].includes('admin')) $('.admin-button').removeClass('hidden');

			// Register any change events to mark the form as dirty
			$('.data-input, .input-checkbox').change(function() {
				$(this).addClass('data-dirty');
			})

			setVerifyAllButtonText();
		},
		failFilter=function(xhr, status, error) {
			console.log(`configuring form failed with status ${status} because ${error} with query:\n${sql}`)
		}
	)

	return deferred
}


function confirmDiscardEdits() {
	var confirmed = true;
	if ($('.data-dirty').length) {
		confirmed = window.confirm(`You have unsaved edits. Are you sure you want to reload the form and discard your edits? If not, click 'Cancel' and then 'save.'`)
	}
	return confirmed;
}


function onMonthSelectChange() {
	
	if (!confirmDiscardEdits()) {
		$('#month-select').val(CURRENT_DATE);
		return;
	}

	showLoadingIndicator();
	
	const dateString = $('#month-select').val();
	const periodDate = new Date(dateString + 'T12:00:00.000-08:00');
	configureForm(periodDate)
		.then(() => {
			resizeColumns();
			hideLoadingIndicator();
		});
	
	// Make sure any JS text is cleared
	$('#js-text').text('').addClass('hidden');

	CURRENT_DATE = $('#month-select').val();

	UNDO_BUFFER = {};//whipe buffer so unrelated fields aren't changed

}


function userDidEdit(thisID){
	DATA[thisID].last_edited_by = $('#username').text();
	DATA[thisID].last_edit_time = getFormattedTimestamp();
}


function onDataInputChange(inputID, promptIfVerified=true) {
	/*Handle changes to an input text field*/

	const thisInput = $('#' + inputID);
	const parentRow = thisInput.closest('.data-input-row');
	const verifiedCheckbox = parentRow.find('.verified-checkbox');
	const verifiedBy = parentRow.find('.verified-by-label').text().trim();
	const labelID = parentRow.attr('data-label-id');
	const username = $('#username').text().trim();
	var commitChange = true;

	// Reset the undo buffer
	const currentUndoBuffer = {...UNDO_BUFFER}; //record current buffer in case user doesn't confirm change
	UNDO_BUFFER = {
		id: labelID,
		previousData: {...DATA[labelID]},
		elementID: thisInput.attr('id'),
		value: DATA[labelID].value,
		wasDirty: parentRow.hasClass('data-dirty') 
	};

	//If this value has already been verified (by someone else), confirm the change
	//if ()
	if (verifiedCheckbox.prop('checked') && verifiedBy !== username && promptIfVerified) {
		commitChange = window.confirm(`Are you sure you want to change this value? It was already verified by ${verifiedBy}`);
		if (commitChange) { 
			DATA[labelID].value = thisInput.val();
			DATA[labelID].verified = false;
			DATA[labelID].verified_by = null;
			DATA[labelID].verified_time = null;
			userDidEdit(labelID);
			parentRow.find('.verified-by-label').text('');
			verifiedCheckbox.prop('checked', false);
		} else {
			// Revert change
			thisInput.val(DATA[labelID].value);
			UNDO_BUFFER = {...currentUndoBuffer};
		}
	// This value has not yet been saved to the db
	} else if (DATA[labelID].is_new_value) { 
		DATA[labelID].value = thisInput.val();
		DATA[labelID].is_estimated = parentRow.find('.estimated-checkbox').prop('checked');
		DATA[labelID].verified = verifiedCheckbox.prop('checked');
		DATA[labelID].period_id = COUNT_PERIODS[$('#month-select').val()];
		DATA[labelID].entered_by = username;
		if (DATA[labelID].verified) {
			DATA[labelID].verified_by = verifiedBy;
			DATA[labelID].verified_time = getFormattedTimestamp();
		}
		userDidEdit(labelID);
	// Already been saved before
	} else {
		DATA[labelID].value = thisInput.val();
		userDidEdit(labelID);
	}
}


function onVerifiedCheckboxChange(labelName) {
	/*When the user checks an uncheck verified-by checkbox, add their name and update related fields*/
	let thisCheckbox = $('#checkbox-verified-' + labelName);
	let parentRow = thisCheckbox.closest('.data-input-row');
	let thisInput = parentRow.find('.input-column > .data-input');
	let thisID = parentRow.attr('data-label-id');

	// Reset the undo buffer
	const currentUndoBuffer = {...UNDO_BUFFER}; //record current buffer in case user doesn't confirm change
	UNDO_BUFFER = {
		id: thisID,
		previousData: {...DATA[thisID]},
		elementID: thisCheckbox.attr('id'),
		value: !thisCheckbox.prop('checked'),//value already changed so set to opposite 
		wasDirty: parentRow.hasClass('data-dirty')
	};

	if (thisCheckbox.prop('checked')) {
		//Check if the field is empty. If so, ask the user if they want to fill it with 0
		var confirmed = true;
		if (thisInput.val() === "") {
			confirmed = confirm('This field is empty. Do you want to fill it with "0"?');
			if (confirmed) {
				thisInput.val(0);
				DATA[thisID].value = thisInput.val();
			} else {
				thisCheckbox.prop('checked', false); //revert to unverified
				UNDO_BUFFER = {...currentUndoBuffer};
			}
		}
		if (confirmed) {
			let username = $('#username').text();
			$('#data-row-' + labelName).find('.verified-by-label').text(username);
			DATA[thisID].verified = true;
			DATA[thisID].verified_by = username;
			DATA[thisID].verified_time = getFormattedTimestamp();
			userDidEdit(thisID);

		}
	} else {
		$('#data-row-' + labelName).find('.verified-by-label').text('');
		DATA[thisID].verified = false;
		DATA[thisID].verified_by = null;
		DATA[thisID].verified_time = null;
		userDidEdit(thisID);
	}

	setVerifyAllButtonText();

}


function onEstimatedCheckboxChange(labelName) {
	let thisCheckbox = $('#checkbox-estimated-' + labelName)
	let thisID = thisCheckbox.closest('.data-input-row').attr('data-label-id')

	UNDO_BUFFER = {
		id: thisID,
		previousData: {...DATA[thisID]},
		elementID: thisCheckbox.attr('id'),
		value: !thisCheckbox.prop('checked'),//value already changed so set to opposite
		wasDirty: thisCheckbox.closest('.data-input-row').hasClass('data-dirty') 
	};

	DATA[thisID].is_estimated = thisCheckbox.prop('checked');
}


function undoEdit() {

	// If the user didn't make any changes yet, the undo buffer will be empty so just return
	if (Object.keys(UNDO_BUFFER).length === 0) {
		alert(`You haven't made any changes to undo yet`)
		return;
	}

	var thisElement = $('#' + UNDO_BUFFER.elementID);
	const currentUndoBuffer = {...UNDO_BUFFER};
	var currentValue; 
	
	if (UNDO_BUFFER.elementID.startsWith('input')) {
		currentValue = thisElement.val();
		thisElement.val(currentUndoBuffer.value);
		DATA[currentUndoBuffer.id].value = currentUndoBuffer.value;
	} else if (UNDO_BUFFER.elementID.startsWith('checkbox-verified')) {
		currentValue = thisElement.prop('checked');
		
		// Set the checkbox value
		thisElement.prop('checked', currentUndoBuffer.value);
		
		// Set the verified_by label text
		const verifiedBy = currentUndoBuffer.previousData.verified_by;
		const verifiedByLabel = thisElement.closest('.data-input-row').find('.verified-by-label');
		const currentVerifiedBy = verifiedByLabel.text();
		verifiedByLabel.text(verifiedBy);
		DATA[currentUndoBuffer.id].verified_by = verifiedBy;
		DATA[currentUndoBuffer.id].verified = currentUndoBuffer.value
		
		//Update the buffer's verified_by property so it can be reset
		UNDO_BUFFER.previousData.verified_by = currentVerifiedBy;
	} else {
		currentValue = thisElement.prop('checked');
		thisElement.prop('checked', currentUndoBuffer.value);
		DATA[currentUndoBuffer.id].is_estimated = currentUndoBuffer.value
	}

	//Update the UNDO_BUFFER so it's redy to redo the edit
	UNDO_BUFFER.value = currentValue;
	
	// If the data were saved since the last edit, mark the row as dirty
	if (!UNDO_BUFFER.wasDirty) thisElement.closest('.data-input-row').addClass('data-dirty');
	//thisElement.closest('.data-input-row').toggleClass('data-dirty');
}


function onKeyDown(e) {

	if (e.key === 'z' && e.ctrlKey && !e.shiftKey) {
		undoEdit();
	}

}

function onSaveClick(event) {
	
	showLoadingIndicator();

	event.returnValue = false;

	var sqlStatements = [];
	var sqlParameters = [];
	var newInserts = [];
	$('.data-input-row').filter(function() {
			return !(
				$(this).hasClass('form-data-header') || 
				$(this).hasClass('form-data-footer') || 
				$(this).hasClass('hidden')
			)
		})
		.each(function() {
		const thisID = $(this).attr('data-label-id');
		const thisObj = DATA[thisID];
		let dataValue = thisObj.value;
		
		if (parseInt(thisObj.is_new_value)) {
			dataValue = thisObj.value;
			
			if (dataValue === null) return; // If the user hasn't entered anything in the app either, skip it

			sqlStatements.push(
				`INSERT INTO counts 
					(value_label_id, value, period_id, entered_by, submission_time, verified, verified_by, verified_time, is_estimated) 
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`
			)
			sqlParameters.push([thisID, dataValue, thisObj.period_id, thisObj.entered_by, getFormattedTimestamp(), thisObj.verified, thisObj.verified_by, thisObj.verified_time, thisObj.is_estimated])
			newInserts.push(thisID);
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
        	if (resultString.startsWith('ERROR') || resultString === "false" || resultString === "php query failed") {
        		alert('Unabled to save changes to the database. ' + resultString);
        		return false; // Save was unsuccessful
        	} else {
        		$('.data-dirty').removeClass('data-dirty')
        		// Set each INSERTed object's is_new_value property to 0
        		newInserts.forEach((id) => {DATA[id].is_new_value = 0});
        		return true; // Save was successful
        	}
        	hideLoadingIndicator();
        }
	)
}


function closeImportDataModal() {

	$('#import-data-background').remove();
	$('#import-data-modal').remove();
}


function parsePythonErrorString(stderr) {
	/*Find the actual python error in a returned stderr string*/
	var error;
	var dbErrorDetail = stderr.match(/[\r\n]DETAIL.*[\r\n]/);
	if (dbErrorDetail != null) {
		error = dbErrorDetail.toString().replace('DETAIL: ', '').trim();
	} else {
	    var lines = stderr.split('\n');
	    var errorName = stderr.match(/[A-Z][a-z]*Error/)//standard python Exception ends in "Error" (e.g., ValueError);
	    
	    for (lineNumber in lines) {
	        if (lines[lineNumber].startsWith(errorName)) {
	            error = lines[lineNumber];
	            break;
	        }
	    }
	}

	return error;
}


function loadJVReport(responseText, statusText, xhr, $form) {

	responseText = responseText.trim();
	const pythonError = parsePythonErrorString(responseText);
	const dataType = $('#data-type-select > option:selected').text();
	const username = $('#username').text();

	if (pythonError !== undefined) {
		alert('An error occurred while trying to load the report: ' + responseText);
	} else if (responseText.startsWith('ERROR')) {
		alert('A server error occurred while trying to load the report: ' + responseText);
	} else {
		// The script ran successfull and returned a JSON string
		data = $.parseJSON(responseText);
		for (retrieve_data_label in data) {
			const thisID = $(this)
			const thisValue = data[retrieve_data_label];
			const thisRow = $(`#data-row-${retrieve_data_label}`);
			const thisInput = $(`#input-${retrieve_data_label}`);

			// Update form
			thisInput.val(thisValue);
			thisRow.find('.estimated-checkbox').prop('checked', false);
			thisRow.find('.verified-checkbox').prop('checked', true);

			// Update global DATA object
			thisRow.find('.verified-by-label').text(username);
			onDataInputChange('input-' + retrieve_data_label, promptIfVerified=false);
		}

		closeImportDataModal();
		hideLoadingIndicator('onImportButtonClick');		
		alert(`JV ${dataType} data successfullly loaded`)
	}

}


function onImportButtonClick(event) {
	
	event.returnValue = false;
	const countDate = $('#month-select').val();

	$(
	`<div class="modal-background modal-background-dark" id="import-data-background"></div>
	<div class="modal-content modal-light" id="import-data-modal">
		<div class="import-data-modal-row distribute-horizontally">
			<h5>Upload data from a JV report</h5>
			<label>Uploading for <strong>${$('#month-select > option:selected').text()}</strong></label>
		</div>
		<form id="jv-report-form" method="POST" enctype="multipart/form-data" action="vistats.php">
			<input class="hidden" type="text" value="${countDate}" name="countDate">
			<div class="import-data-modal-row mb-0">
				<label>Report type</label>
			</div>
			<div class="import-data-modal-row">
				<select class="import-data-row-item import-data-text-item" id="data-type-select" name="reportType">
					<option class="select-option" value='campgrounds'>Campgrounds</option>
					<option class="select-option" value='buses'>Bus ridership</option>
				</select>
				<label class="import-data-row-item text-center generic-button file-input-label mx-0" for="file-upload">browse</label>
				<input id="file-upload" type="file" accept=".csv, .xls, .xlsx" name="uploadedFile">
			</div>
			<div class="import-data-modal-row">
				<label class="import-data-row-item import-data-text-item" id="import-filename-label"></label>
			</div>
			<div class="import-data-modal-row center-horizontally">
				<button class="generic-button import-data-row-item secondary-button" onclick="closeImportDataModal()">cancel</button>
				<input class="generic-button import-data-row-item hidden" type="submit" value="load" name="submit">
			</div>
		</form

	</div>`).appendTo('body');
	
	$('#file-upload').change(function() {
		if (this.files.length > 0) {
			$('#import-filename-label').text(this.files[0].name);
			$('.import-data-modal-row.center-horizontally').addClass('distribute-horizontally').removeClass('center-horizontally');
			$('.generic-button.import-data-row-item').removeClass('hidden');
		}
		
	})	

	$('#import-data-background').click(closeImportDataModal);

	$('#jv-report-form').ajaxForm({
		success: loadJVReport,
		clearForm: false,
		resetForm: false
	}).submit(() => {showLoadingIndicator('onImportButtonClick')}); // show loading indicator when form is submitted

}


function getBrowser() {
	/*
	Code to get browser name. Useful for determining Selenium driver to user.
	It's not necessarily guaranteed to work in the future, but it seems to work now.
	From https://stackoverflow.com/a/9851769/12075411
	*/ 

	var isChrome = !!window.chrome && (!!window.chrome.webstore || !!window.chrome.runtime);
	var isIE = /*@cc_on!@*/false || !!document.documentMode;
	if ((!!window.opr && !!opr.addons) || !!window.opera || navigator.userAgent.indexOf(' OPR/') >= 0) {
		return 'opera';
	} else if (typeof InstallTrigger !== 'undefined') {
		// Firefox 1.0+
		return 'firefox';
	} else if (/constructor/i.test(window.HTMLElement) || (function (p) { return p.toString() === "[object SafariRemoteNotification]"; })(!window['safari'] || (typeof safari !== 'undefined' && safari.pushNotification))){
		// Safari 3.0+ "[object HTMLElementConstructor]" 
		return 'safari';
	} else if (isIE) {
		return 'ie'
	} else if (!isIE && !!window.StyleMedia) {
		return 'edge';
	} else if (isChrome && (navigator.userAgent.indexOf("Edg") != -1)) {
		// Edge (based on chromium) detection
		return 'edge-chromium';
	} else if (isChrome) {
		return 'chrome';
	}

}


function copyToClipboard(elementID, deselect=true) {
	
	var range = document.createRange();
	range.selectNode(document.getElementById(elementID));
	
	// clear current selection
	window.getSelection().removeAllRanges(); 
	
	window.getSelection().addRange(range); // to select text
	
	document.execCommand("copy");
	
	// Deselect
	if (deselect) window.getSelection().removeAllRanges();
}


function generateJavascript(event) {

	event.returnValue = false;

	// check if any values are not yet verified
	var visibleCheckboxes = $('.verified-checkbox').filter(function() {return !$(this).closest('.data-input-row').hasClass('hidden')});
	if (visibleCheckboxes.not(':checked').length) {
		if (!window.confirm('Some values are not yet verified. Are you sure you want to continue?')) return;
	}

	const selectedDate = new Date($('#month-select').val() + 'T12:00:00.000-08:00');
	const monthNumber = selectedDate.getMonth() + 1;
	const monthName = selectedDate.toLocaleString('default', { month: 'long' });
	const irmaURL = `https://irma.nps.gov/STATS/Data/Input?month=${monthNumber}&year=${selectedDate.getFullYear()}&unit=DENA`;

	var jsString = ''//`document.getElementById('periodComboId-inputEl').value = '${monthName}, ${selectedDate.getFullYear()}';\n`

	$('.data-input-row').filter(function(_, el) {return !$(el).hasClass('form-data-header') && !$(el).hasClass('form-data-footer')}).each(function() {
		const thisInput = $(this).find('.data-input');
		var thisValue = thisInput.val();
		if (thisValue === "" || thisValue === undefined) thisValue = 0;//return;
		const irmaElementID = thisInput.attr('data-irma-element');
		jsString += `document.getElementById(${irmaElementID}).value = ${thisValue};\n`;
		const isEstimated = $('#' + thisInput.attr('id').replace('input-', 'checkbox-estimated-')).prop('checked')
		if (isEstimated) {
			jsString += `document.getElementById(${irmaElementID}).classList.add('aprox');\n`;
			jsString += `document.getElementById(${irmaElementID}).setAttribute('isaprox', '1');\n`;
		}
	})


	isWinter = monthNumber < 5 || monthNumber > 9;
	jsString += `document.getElementById(49727).value = ${isWinter ? 1 : 0};`

	$(	
	`<div class="modal-background modal-background-dark" id="js-modal-background"></div>
	<div class="modal modal-light" id="js-text-modal">
		<p id="js-text"></p>
		<div class="import-data-modal-row center-horizontally">
			<button class="generic-button import-data-row-item secondary-button" id="close-js-modal-button">close</button>
			<button class="generic-button import-data-row-item" type="button" id="copy-js-button">copy javascript</button>
			<button class="generic-button import-data-row-item" type="button" id="open-irma-form-button">open IRMA form</button>
		</div>
	</div>`).appendTo('body')

	$('#js-modal-background, #close-js-modal-button').click(() => {
			$('#js-modal-background').remove();
			$('#js-text-modal').remove();
	});
	
	$('#open-irma-form-button').click(() => {
		// Open the IRMA STATS page
		var win = window.open(irmaURL, '_blank');
		if (win) {
		    //Browser has allowed it to be opened
		    win.focus();
		} else {
		    //Browser has blocked it
		    alert(`Your browser has blocked this page from opening the IRMA STATS page. Please allow popups or navigate to ${irmaURL} manually.`);
		}
	})

	$('#copy-js-button').click(() => {
		copyToClipboard('js-text', deselect=false);
		alert('javascript text copied to clipboard');
	})
	
	$('#js-text')
		.text(jsString)
		.removeClass('hidden');

	// Select the text field
	copyToClipboard('js-text', deselect=false);

	setTimeout(() => {alert('javascript text copied to clipboard')}, 300);

}



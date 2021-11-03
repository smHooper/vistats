/* Site-wide applicable functions */

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


function showLoadingIndicator(caller, timeout=15000) {

	//set a timer to turn off the indicator after a max of 15 seconds because 
	//  sometimes hideLoadingIndicator doesn't get called or there's some mixup 
	//  with who called it
	if (timeout) {
		setTimeout(hideLoadingIndicator, timeout);
	}
	
	// For anonymous functions, the caller is undefined, so (hopefully) the 
	//	function is called with the argument given
	var thisCaller = caller == undefined ? showLoadingIndicator.caller.name : caller;

	var indicator = $('#loading-indicator').removeClass('hidden')
	$('#loading-indicator-background').removeClass('hidden');

	// check the .data() to see if any other functions called this
	indicator.data('callers', indicator.data('callers') === undefined ? 
		[thisCaller] : indicator.data('callers').concat([thisCaller])
	)

}


function hideLoadingIndicator(caller) {
	

	var indicator = $('#loading-indicator')
	// if no caller was given, just remove the indicator
	if (caller === undefined || indicator.data('callers') == undefined) {
		 indicator.data('callers', [])
	} else if (indicator.data('callers').includes(caller)) {
		indicator.data(
			'callers', 
			indicator.data('callers').filter(thisCaller => thisCaller != caller)
		);
	}

	// Hide the indicator if there are no more callers
	if (!indicator.data('callers').length) {
		$('#loading-indicator-background').addClass('hidden');
		indicator.addClass('hidden');
	}

}

/* Cookies (for saving plotting options) */
function setCookie(name, value, days) {
    var expires = "";
    if (days) {
        var date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }

    document.cookie = name + "=" + encodeURIComponent(value || "")  + expires + "; path=/";
}


function getCookie(name) {
    var nameEQ = name + "=";
    var componets = document.cookie.split(';');
    for(var i=0; i < componets.length; i++) {
        var c = decodeURIComponent(componets[i]);
        while (c.charAt(0)==' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}


function eraseCookie(name) {   
    document.cookie = name +'=; Path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
}

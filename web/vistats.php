

<?php

include '../config/vistats-entry-config.php';


function runQuery($ipAddress, $port, $dbName, $username, $password, $queryStr, $parameters=array()) {
	/*return result of a postgres query as an array*/

	$conn = pg_connect("hostaddr=$ipAddress port=$port dbname=$dbName user=$username password=$password");

	if (!$conn) {
		return array("db connection failed");
	}

	$result = pg_query_params($conn, $queryStr, $parameters);
	if (!$result) {
	  	echo pg_last_error();
	  	return array();
	}

	$resultArray = pg_fetch_all($result) ? pg_fetch_all($result) : array("query returned an empty result");
	return $resultArray;
}


function runQueryWithinTransaction($conn, $queryStr, $parameters=array()) {

	$result = pg_query_params($conn, $queryStr, $parameters);
	if (!$result) {
		$err = array(pg_last_error($conn));
	  	return $err;
	}
	$pgFetch = pg_fetch_all($result);
	return $pgFetch ? $pgFetch : null;

}


function queryMSSQL($conn, $sql) {

	$stmt = sqlsrv_query($conn, $sql);

	if ($stmt === false) {
		return sqlsrv_errors();
	}

	$data = array();
	while( $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
		$data[] = $row;
	}

	return $data;
}


function runCmd($cmd) {
	// can't get this to work for python commands because conda throws
	// an error in conda-script (can't import cli.main)
	$process = proc_open(
		$cmd,
		array(
			0 => array("pipe", "r"), //STDIN
		    1 => array('pipe', 'w'), // STDOUT
		    2 => array('pipe', 'w')  // STDERR
		),
		$pipes,
		NULL,
		NULL,
		array('bypass_shell' => false)
	);

	$resultObj;

	if (is_resource($process)) {

	    $resultObj->stdout = stream_get_contents($pipes[1]);
	    fclose($pipes[1]);

	    $resultObj->stderr = stream_get_contents($pipes[2]);
	    fclose($pipes[2]);

	    $returnCode = proc_close($process);

	    if ($returnCode) {
	    	echo json_encode($resultObj);
	    } else {
	    	echo 'nothing';//false;
	    }
	} else {
		echo json_encode($_SERVER);
	}
}


function deleteFile($filePath) {

	$fullPath = realpath($filePath);

	if (file_exists($fullPath) && is_writable($fullPath)) {
		unlink($fullPath);
		return true;
	} else {
		return false;
	}
}


if (isset($_POST['submit']) && isset($_FILES['uploadedFile'])) {

	$fileName = preg_replace('/[^\w.]+/', '_', basename($_FILES['uploadedFile']['name']));
	$uploadFilePath = "temp_files/$fileName";

	if (move_uploaded_file($_FILES['uploadedFile']['tmp_name'], $uploadFilePath)) {

		if (isset($_POST['reportType'])) {
			// this is from the import-data-modal form
			$countDate = $_POST['countDate'];
			$scriptName = strtolower($_POST['reportType']) === 'campgrounds' ? 'read_campground_report.py' : 'read_bus_ridership_report.py';
			$cmd = "conda activate vistats && python ../py/$scriptName \"$uploadFilePath\" $countDate 2>&1 && conda deactivate";
			$output = null;
			$resultCode = null;
			exec($cmd, $output, $resultCode);

			deleteFile($uploadFilePath);

			// for some reason, $output is an array with one element, the stdout string
			//	In order to return just the stdout string (which is a JSON object encoding
			//	as a string!), I have to get the 0th element, convert to a JSON object,
			//	then convert back to a string to send the respoonse back to the browser
			//	In case the Python script returned an error (and therefore json_decode would
			//	fail), wrap it in a try/catch closure
			try {
				$jsonOutput = json_decode($output[0]);
			} catch (Exception $ex) {
				echo(json_decode($output));
				exit();
			}
			echo(json_encode($jsonOutput));
		} else {
			echo "ERROR: file upload for this form is not set up yet";
			deleteFile($uploadFilePath);
		}
	} else {
		echo "ERROR: file uploaded was not valid: $uploadFilePath ";
	}

}


if (isset($_POST['action'])) {

	// retrieve the names of all files that need to be edited
	if ($_POST['action'] == 'getFiles') {
		$json_files = array_filter(glob('data/*geojsons.json'));
		echo json_encode($json_files);
	}

	// write json data to the server
	if ($_POST['action'] == 'writeFile') {
		// check that both the json string and the path to write the json to were given

		if (isset($_POST['jsonString']) && isset($_POST['filePath'])) {
			$success = file_put_contents($_POST['filePath'], $_POST['jsonString']);
			echo $success;
		} else {
			echo false;
		}
	}

	if ($_POST['action'] == 'getUser') {
		if ($_SERVER['AUTH_USER']) echo preg_replace("/^.+\\\\/", "", $_SERVER["AUTH_USER"]);
    	else echo false;

	}

	if ($_POST['action'] == 'getUserRoles') {
		echo json_encode($USER_ROLES);
	}
	
	if ($_POST['action'] == 'query') {

		if (isset($_POST['queryString']) && isset($_POST['db'])) {
			if ($_POST['db'] == 'vistats') {
				$result = runQuery($dbhost, $dbport, $dbname, $username, $password, $_POST['queryString']);
				echo json_encode($result);
			} else if ($_POST['db'] == 'irma') {
				$conn = sqlsrv_connect($irmaServerName, $irmaConnectionInfo);
				if (!$conn) {
					echo "ERROR: could not connect to IRMA Stats DB because " + sqlsrv_errors();
				}
				$result = queryMSSQL($conn, $_POST['queryString']);
				echo json_encode($result);
			} else {
				echo "ERROR: db name not understood";
			}

		} else {
			echo "ERROR: db or queryString not set";//false;
		}
	}

	if ($_POST['action'] == 'paramQuery') {

		if (isset($_POST['queryString']) && isset($_POST['params'])) {
			// If there are multiple SQL statements, execute as a single transaction
			if (gettype($_POST['queryString']) == 'array') {
				$conn = pg_connect("hostaddr=$dbhost port=$dbport dbname=$dbname user=$username password=$password");
				if (!$conn) {
					echo "ERROR: Could not connect DB";
					exit();
				}

				// Begin transaction
				pg_query($conn, 'BEGIN');

				$resultArray = array();
				for ($i = 0; $i < count($_POST['params']); $i++) {
					// Make sure any blank strings are converted to nulls
					$params = $_POST['params'][$i];
					for ($j = 0; $j < count($params); $j++) {
						if ($params[$j] === '') {
							$params[$j] = null;
						}
					}
					$result = runQueryWithinTransaction($conn, $_POST['queryString'][$i], $params);
					if (strpos(json_encode($result), 'ERROR') !== false) {
						// roll back the previous queries
						pg_query($conn, 'ROLLBACK');
						echo $result, " from the query $i ", $_POST['queryString'][$i], ' with params ', json_encode($params);
						exit();
					}

					$resultArray[$i] = $result;
				}

				// COMMIT the transaction
				pg_query($conn, 'COMMIT');

				echo json_encode($resultArray);

			} else {
				$params = $_POST['params'];
				for ($j = 0; $j < count($params); $j++) {
					if ($params[$j] === '') {
						$params[$j] = null;
					}
				}
				$result = runQuery($dbhost, $dbport, $dbname, $username, $password, $_POST['queryString'], $params);
				
				echo json_encode($result);	
			}
		} else {
			echo "php query failed";//false;
		}
	}

	if ($_POST['action'] == 'readTextFile') {
		if (isset($_POST['textPath'])) {
			echo file_get_contents($_POST['textPath']);
		}
	}

	if ($_POST['action'] == 'deleteFile') {
		if (isset($_POST['filePath'])) {
			echo deleteFile($_POST['filePath']) ? 'true' : 'false';
			echo $_POST['filePath'];
		} else {
			echo 'filepath not set or is null';
		}
	}
}

?>
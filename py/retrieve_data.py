import os
import sys
import json
import re
import glob
import traceback
import pyodbc
import requests
import datetime
import calendar
import sqlalchemy
from dateutil import relativedelta
import pandas as pd

pd.set_option('display.max_columns', None)

BC_PERMIT_DB_NORTH_PATH = r"\\inpdenafiles\parkwide\Backcountry\Backcountry Permit Database\BC Permits Data %s.mdb"
BC_PERMIT_DB_SOUTH_PATH = r"\\inpdenatalk\talk\ClimbersDatabase\Backcountry Permit Database\BC Permits Data %s.mdb"
CLIMBING_PERMIT_DB_PATH = r"\\inpdenatalk\talk\ClimbersDatabase\backend\DenaliNPSData.mdb"
MSLC_VISITOR_COUNT_PATH = r"\\inpdenafiles\teams\Interp\Ops All, Statistics\MSLC Winter VC, Education\* Winter VC Stats.xlsx"

LOG_DIR = r"\\inpdenards\vistats\retrieve_data_logs"

VEA_LOCATION_NAMES = {
    'Winter Visitor Center': 'mslc_visitors',
    'Summer Visitor Center': 'dvc_visitors'
}


LODGE_BUS_FIELDS = {
    'CDN': 'camp_denali_bus_passengers',
    'DBL': 'denali_backcountry_lodge_bus_passengers',
    'KRH': 'kantishna_roadhouse_bus_passengers'
}

# Define the label IDs that should be automatable so that if the associated query returns an empty result, it can be
#   filled with a 0 to distinguish them from values that have yet to be filled in
VALUE_LABEL_IDS = {'winter':
    [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        10
    ], 'summer':
    [
        13,
        14,
        15,
        21,
        22,
        23,
        24,
        27,
        29,
        31,
        32,
        33,
        34,
        35,
        36,
        37,
        38,
        40,
        50,
        52,
        53
    ]
}

def read_json_params(params_json):
    '''
    Read and validate a parameters JSON file
    :param params_json: path to JSON file
    :return: dictionary of params
    '''
    required = pd.Series(['ssl_cert',
                          'vea_client_id',
                          'vea_client_secret',
                          'vistats_db_credentials',
                          'savage_db_credentials'
                          ])
    with open(params_json) as j:
        params = json.load(j)
    missing = required.loc[~required.isin(params.keys())]
    if len(missing):
        if 'LOG_DIR' in params.keys():
            msg = 'Invalid config JSON: {file}. It must contain all of "{required}" but "{missing}" are missing'\
                         .format(file=params_json, required='", "'.join(required), missing='", "'.join(missing))
        raise ValueError(msg)

    return params


def write_log(log, LOG_DIR, timestamp):
    log_file_path = os.path.join(LOG_DIR, '{0}_log_{1}.json'.format(os.path.basename(__file__).replace('.py', ''),
                                                                    re.sub('\D', '', timestamp)))
    with open(log_file_path, 'w') as f:
        json.dump(log, f, indent=4)


def main(param_file, current_date=None):

    now = datetime.datetime.now()
    if current_date:
        try:
            current_date = datetime.datetime.strptime(current_date, '%Y-%m-%d')
        except:
            # Raise this error instead of logging because a call signature with current_date specified will only be run
            #   manually (not by an automated task)
            raise ValueError('Current date "%s" not understood' % current_date)
    else:
        current_date = now
    query_date = current_date - relativedelta.relativedelta(months=1)
    query_year = query_date.year
    query_month = query_date.month
    start_date = '{year}-{month}-1'.format(year=query_year, month=query_month)
    end_date = '{year}-{month}-1'.format(year=current_date.year, month=current_date.month)
    season = 'summer' if query_month in range(5, 10) else 'winter'

    # Make the log dir in case it doesn't already exist and set up a log dictionary for storing errors/messages
    if not os.path.isdir(LOG_DIR):
        os.makedirs(LOG_DIR)

    log = {
        'run_time': now.strftime('%Y-%m-%d %H:%M'),
        'errors': [],
        'messages': []
    }

    if not os.path.isfile(param_file):
        log['errors'] = 'param_file %s does not exist' % param_file
        sys.exit()

    try:
        params = read_json_params(param_file)
    except:
        log['errors'] = traceback.format_exc()
        sys.exit()

    data = []

    ##############################################################################################################
    ######################### BC Permit DBs ######################################################################
    ##############################################################################################################
    users_sql = '''
        SELECT 
        sum(users) AS bc_users,
        sum(user_nights) AS bc_user_nights
        FROM (
            SELECT
                1 AS constant,
                MAX(Itinerary.[Number of People]) AS users,
                SUM(Itinerary.[Number of People]) as user_nights 
            FROM Itinerary
            WHERE 
                MONTH(Itinerary.[Camp Date])={month} AND
                YEAR(Itinerary.[Camp Date])={year}
            GROUP BY MONTH(Itinerary.[Camp Date]), [permit number]
        ) 
        GROUP BY constant;
    '''.format(month=query_month, year=query_year)

    for side, path in {'north': BC_PERMIT_DB_NORTH_PATH, 'south': BC_PERMIT_DB_SOUTH_PATH}.items():
        bc_permit_db_path = path % query_year
        if not os.path.isfile(bc_permit_db_path):
            log['errors'].append({'action': 'reading %s BC permit DB' % side,
                                  'error': 'BC Permit DB for {side} side does not exist: {path}'
                                    .format(side=side, path=bc_permit_db_path)
                                  })
        else:
            try:
                conn = pyodbc.connect(r'DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};'
                                      r'DBQ=%s' % (bc_permit_db_path))
                bc_stats = pd.read_sql(users_sql, conn)
                conn.close()
            except:
                log['errors'].append({'action': 'reading %s BC permit DB' % side,
                                      'error': traceback.format_exc()
                                      })
            data.append(bc_stats\
                            .rename(columns={c: c + '_{}_{}'.format(side, season) for c in bc_stats.columns})\
                            .T\
                            .reset_index()\
                            .rename(columns={'index': 'value_label_id', 0: 'value'})
                        )

    ##############################################################################################################
    ################################### climbing permits #########################################################
    ##############################################################################################################
    sql = '''
        TRANSFORM count(*) AS val
        SELECT 
            tblGroupsRes.ClimberID
        FROM 
            (
                qryGroupsDates INNER JOIN tblGroupsRes ON qryGroupsDates.GroupID = tblGroupsRes.GroupID
            ) INNER JOIN (
            tblGroupsResRoutes INNER JOIN tblRoutes ON tblGroupsResRoutes.RouteCode = tblRoutes.RouteCode
            ) ON tblGroupsRes.GroupResID = tblGroupsResRoutes.GroupResID
        WHERE 
            tblGroupsRes.Status <>'CAN' AND 
            Month(qryGroupsDates.date_) = {month} AND
            Year(qryGroupsDates.date_) = {year}
        GROUP BY Month(qryGroupsDates.date_), tblGroupsRes.ClimberID
        PIVOT tblRoutes.Mountain;
    '''.format(month=query_month, year=query_year)

    if not os.path.exists(CLIMBING_PERMIT_DB_PATH):
        log['errors'].append({'action': 'querying climbing permit DB',
                              'error': 'File does not exist: %s' % CLIMBING_PERMIT_DB_PATH})
    else:
        user_nights = pd.DataFrame()
        try:
            conn = pyodbc.connect(r'DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};'
                                  r'DBQ=%s' % (CLIMBING_PERMIT_DB_PATH))
            user_nights = pd.read_sql(sql, conn)
            conn.close()
        except:
            log['errors'].append({'action': 'querying climbing permit DB',
                                  'error': traceback.format_exc()
                                  })
        if len(user_nights):
            climbing_stats = user_nights\
                .drop(columns=['ClimberID'])\
                .sum()\
                .rename({'Denali': 'denali_climber_user_nights',
                         'Foraker': 'foraker_climber_user_nights'})
            climbing_stats['denali_climbers'] = len(user_nights['Denali'].dropna())
            climbing_stats['foraker_climbers'] = len(user_nights['Foraker'].dropna())

        else:
            climbing_stats = pd.Series({
                'denali_climber_user_nights': 0,
                'foraker_climber_user_nights': 0,
                'denali_climbers': 0,
                'foraker_climbers': 0
            })

        data.append(pd.DataFrame({
            'value_label_id': ['%s_%s' % (label, season) for label in climbing_stats.index],
            'value': climbing_stats.values}
        ))


    ###########################################################################################################
    ################################## visitor center counts ##################################################
    ###########################################################################################################
    # Get token
    try:
        token_response = requests.post('https://auth.sensourceinc.com/oauth/token',
                                       headers={"Content-type": "application/json"},
                                       data='{' + '''
                                           "grant_type": "client_credentials", 
                                           "client_id": "{vea_client_id}", 
                                           "client_secret": "{vea_client_secret}"
                                           '''.format(**params) + '}',
                                       verify=params['ssl_cert'])
        token_response.raise_for_status()
        token = token_response.json()['access_token']
    except:
        log['errors'].append({'action': 'querying Vea REST API token',
                              'error': traceback.format_exc()
                              })

    # Get ID for location
    if 'token' in locals():
        try:
            response = requests.get('https://vea.sensourceinc.com/api/location',
                                    headers={"Content-type": "application/json",
                                             'Authorization': 'Bearer %s' % token},
                                    verify=params['ssl_cert'])
            response.raise_for_status()
            locations = pd.DataFrame(response.json())
        except:
            log['errors'].append({'action': 'querying Vea REST API location IDs',
                                  'error': traceback.format_exc()
                                  })

    _, last_day_of_month = calendar.monthrange(query_year, query_month)
    if 'locations' in locals():
        try:
            response = requests.get('https://vea.sensourceinc.com/api/data/traffic',
                                    headers={"Content-type": "application/json",
                                             'Authorization': 'Bearer %s' % token},
                                    params={
                                        'relativeDate': 'custom',
                                        'startDate': start_date,
                                        'endDate': end_date,
                                        'dateGroupings': 'month',
                                        'entityType': 'location',
                                        'entityIds': locations.locationId.tolist(),
                                        'metrics': 'ins'
                                    },
                                    verify=params['ssl_cert'])
            response.raise_for_status()
            response_json = response.json()
            if len(response_json['messages']):
                log['messages'].append({'context': 'querying Vea REST API data',
                                        'message': response_json['messages']
                                        })
            # Make a data frame from the result
            #   replace names in the Vea system with names of fields in DB
            #   pivot the data so each location (now fields in the DB) is a column and the data only have one row
            facility_counts = pd.DataFrame(response_json['results'])

            # Even though the endDate parameter is supposed to create a non-
            data.append(
                facility_counts.loc[pd.to_datetime(facility_counts.recordDate_month_1).dt.month == (query_month)] \
                    .replace({'name': {k: '%s_%s' % (v, season) for k, v in VEA_LOCATION_NAMES.items()}}) \
                    .reindex(columns=['name', 'sumins']) \
                    .rename(columns={'name': 'value_label_id',
                                     'sumins': 'value'})
            )
        except:
            log['errors'].append({'action': 'querying Vea REST API data',
                                  'error': traceback.format_exc()
                                  })

    # For now mslc counts should be by hand
    if season == 'winter':
        try:
            mslc_counts_path = glob.glob(MSLC_VISITOR_COUNT_PATH)[0]
            excel_doc = pd.ExcelFile(mslc_counts_path)
        except:
            log['errors'].append({'action': 'reading MSLC hand counts',
                                  'error': traceback.format_exc()
                                  })
        month_names = pd.Series(pd.date_range('2020-1-1', '2021-1-1', freq='M').strftime('%B').str.lower(), index=range(1, 13))
        sheets = pd.Series({sn: sn.lower() for sn in excel_doc.sheet_names if len(sn.split()) == 1})
        this_month_name = month_names[query_month]
        mslc_daily_counts = pd.DataFrame()
        try:
            this_sheet = sheets[sheets.apply(lambda x: this_month_name.startswith(x))].index[0]
            mslc_daily_counts = excel_doc.parse(this_sheet)
            mslc_count = mslc_daily_counts.dropna(axis=0, how='all').iloc[-1, 2]
            data.append(pd.DataFrame([{'value_label_id': 'mslc_visitors_winter', 'value': mslc_count}]))
        except:
            log['errors'].append({'action': 'reading MSLC hand counts sheet for %s' % this_month_name,
                                  'error': traceback.format_exc()
                                  })

    ###########################################################################################################
    ################################## savage db queries ######################################################
    ###########################################################################################################

    sql_template = '''
        SELECT '{label}' AS value_label_id, sum(n_passengers) AS value 
        FROM {table} 
        WHERE datetime BETWEEN '{start}' AND '{end}'
        GROUP BY extract(month FROM datetime)
    '''

    lodge_bus_sql = '''
        SELECT bus_type AS value_label_id, sum(n_passengers) AS value 
        FROM buses 
        WHERE 
            datetime BETWEEN '{start}' AND '{end}' AND
            bus_type in (SELECT code FROM bus_codes WHERE is_lodge_bus)
        GROUP BY bus_type, extract(month FROM datetime)
    '''.format(start=start_date, end=end_date)

    research_sql = '''
        SELECT sum(n_passengers) AS value 
        FROM nps_approved 
        WHERE 
            datetime BETWEEN '{start}' AND '{end}' AND
            approved_type = 'RSC' 
        GROUP BY extract(month FROM datetime)
    '''.format(start=start_date, end=end_date)
    lottery_sql = '''
        SELECT 'road_lottery_permits' as value_label_id, count(*) AS value 
        FROM road_lottery
        WHERE datetime BETWEEN '{start}' AND '{end}'
        GROUP BY extract(month FROM datetime)
    '''
    reserved_pov_sql = '''
        SELECT 'reserved_pov_passengers' AS value_label_id, sum(n_passengers) AS value 
        FROM nps_approved 
        WHERE 
            datetime BETWEEN '{start}' AND '{end}' AND
            approved_type = 'REC' 
        GROUP BY value_label_id, extract(month FROM datetime)
    '''.format(start=start_date, end=end_date)
    guided_cua_sql = '''
        SELECT 'guided_cua_pov_passengers' AS value_label_id, sum(n_passengers) AS value 
        FROM nps_approved 
        WHERE 
            datetime BETWEEN '{start}' AND '{end}' AND
            approved_type = 'GUI' 
        GROUP BY value_label_id, extract(month FROM datetime)
    '''.format(start=start_date, end=end_date)

    # Only run this query for summer months
    if season == 'summer':
        try:
            engine = sqlalchemy.create_engine(
                'postgresql://{username}:{password}@{ip_address}:{port}/{db_name}'.format(**params['savage_db_credentials'])
            )

            with engine.connect() as conn:
                bikes = pd.read_sql(sql_template.format(label='cyclists_past_savage', table='cyclists', start=start_date, end=end_date), conn)
                road_lottery = pd.read_sql(lottery_sql.format(start=start_date, end=end_date), conn)
                accessibility = pd.read_sql(sql_template.format(label='accessibility_permit_passengers', table='accessibility', start=start_date, end=end_date), conn)
                photographers = pd.read_sql(sql_template.format(label='pro_photographers', table='photographers', start=start_date, end=end_date), conn)
                reserved_povs = pd.read_sql(reserved_pov_sql, conn)
                guided_cua_povs = pd.read_sql(guided_cua_sql, conn)

                employees = pd.read_sql(sql_template.format(label='non_rec_users', table='employee_vehicles', start=start_date, end=end_date), conn)
                researchers = pd.read_sql(research_sql, conn)
                non_rec_users = pd.DataFrame({'value_label_id': ['non_rec_pov_passengers'],
                                              'value': pd.concat([employees, researchers]).value.sum()
                                              })

                lodge_buses = pd.read_sql(lodge_bus_sql, conn)\
                    .replace({'value_label_id': LODGE_BUS_FIELDS})
            data.extend([bikes, road_lottery, accessibility, photographers, non_rec_users, lodge_buses, reserved_povs, guided_cua_povs])
        except:
            log['errors'].append({'action': 'querying Savage DB',
                                  'error': traceback.format_exc()
                                  })

    ###########################################################################################################
    ################################## glacier landings #######################################################
    ###########################################################################################################
    landings_sql = '''
        SELECT 'scenic_landings_south' AS value_label_id, sum(n_passengers) AS value 
        FROM flights INNER JOIN landings ON flights.id = landings.flight_id
        WHERE 
            landings.landing_type = 'scenic' AND
            flights.departure_datetime BETWEEN '{start}' AND '{end}' AND
            flights.operator_code NOT IN ('TST', 'KAT') 
        GROUP BY value_label_id
    '''.format(start=start_date, end=end_date)
    north_side_sql = '''
        SELECT 'aircraft_visitors_north_winter' AS value_label_id, sum(n_passengers) AS value 
        FROM flights INNER JOIN landings ON flights.id = landings.flight_id
        WHERE 
            flights.departure_datetime BETWEEN '{start}' AND '{end}' AND
            flights.operator_code='KAT'  
        GROUP BY value_label_id
    '''.format(start=start_date, end=end_date)
    try:
        engine = sqlalchemy.create_engine(
            'postgresql://{username}:{password}@{ip_address}:{port}/{db_name}'.format(**params['landings_db_credentials'])
        )
        with engine.connect() as conn:
            data.extend([
                pd.read_sql(landings_sql, conn),
                pd.read_sql(north_side_sql, conn)
            ])
    except:
        log['errors'].append({'action': 'querying landings',
                              'error': traceback.format_exc()
                              })


    #################################### import data ###############################################################
    counts = pd.concat(data, sort=False).drop_duplicates(subset='value_label_id', keep='last').fillna(0)

    try:
        engine = sqlalchemy.create_engine(
            'postgresql://{username}:{password}@{ip_address}:{port}/{db_name}'.format(**params['vistats_db_credentials'])
        )
        with engine.connect() as conn, conn.begin():
            # replace labels with IDs
            label_ids = pd.read_sql("SELECT id, retrieve_data_label FROM value_labels", conn) \
                .set_index('retrieve_data_label')\
                .id.to_dict()
            counts.value_label_id = counts.value_label_id.replace(label_ids).astype(int)

            # Make sure any queries that returned nothing are set to 0 (rather than just missing entirely)
            counts = counts.append(
                pd.DataFrame({'value_label_id': [i for i in VALUE_LABEL_IDS[season] if i not in counts.value_label_id.values]}))\
                .fillna(0)

            # Insert count_period record
            recordset = conn.execute("INSERT INTO count_periods (count_date) VALUES ('%s') RETURNING id" % start_date)
            result = recordset.fetchall()
            recordset.close()
            if len(result) == 1:
                period_id = result[0][0]
            else:
                raise RuntimeError('Invalid result returned from count_period INSERT statement: %s' % result)

            counts['period_id'] = period_id
            counts['entered_by'] = os.path.basename(__file__)
            counts['submission_time'] = now

            # insert counts
            counts.to_sql('counts', conn, index=False, if_exists='append')
    except:
        log['errors'].append({'action': 'importing data',
                              'error': traceback.format_exc()
                              })

    write_log(log, LOG_DIR, now.strftime('%Y%m%d-%H%M'))


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:]))

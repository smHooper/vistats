import os
import sys
import json
import re
import traceback
import pyodbc
import requests
import datetime
import calendar
import sqlalchemy
from dateutil import relativedelta
import pandas as pd

BC_PERMIT_DB_NORTH_PATH = r"\\inpdenafiles\parkwide\Backcountry\Backcountry Permit Database\BC Permits Data %s.mdb"
BC_PERMIT_DB_SOUTH_PATH = r"\\inpdenatalk\talk\ClimbersDatabase\Backcountry Permit Database\BC Permits Data %s.mdb"
CLIMBING_PERMIT_DB_PATH = r"\\inpdenatalk\talk\ClimbersDatabase\DenaliNPS.mdb"

VEA_LOCATION_NAMES = {
    'Winter Visitor Center': 'mslc_visitors',
    'Summer Visitor Center': 'dvc_visitors'
}

WINTER_FIELDS = [

]

LODGE_BUS_FIELDS = {
    'CDN': 'camp_denali_bus_passengers',
    'DBL': 'denali_backcountry_lodge_bus_passengers',
    'KRH': 'kantishna_roadhouse_bus_passengers'
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
        if 'log_dir' in params.keys():
            msg = 'Invalid config JSON: {file}. It must contain all of "{required}" but "{missing}" are missing'\
                         .format(file=params_json, required='", "'.join(required), missing='", "'.join(missing))
        raise ValueError(msg)

    return params


def write_log(log, log_dir, timestamp):
    log_file_path = os.path.join(log_dir, '{0}_log_{1}.json'.format(os.path.basename(__file__).replace('.py', ''),
                                                                    re.sub('\D', '', timestamp)))
    with open(log_file_path, 'w') as f:
        json.dump(log, f)


def main(param_file, log_dir, current_date=None):

    now = datetime.datetime.now()
    if current_date:
        try:
            current_date = datetime.datetime.strftime(current_date, '%Y-%m-%d')
        except:
            # Raise this error instead of logging because a call signature with current_date specified will only be run
            #   manually (not by an automated task)
            raise ValueError('Current date "%s" not understood' % current_date)
    else:
        current_date = now
    query_date = current_date - relativedelta.relativedelta(months=1)
    query_year = query_date.year
    query_month = query_date.month

    # Make the log dir in case it doesn't already exist and set up a log dictionary for storing errors/messages
    if not os.path.isdir(log_dir):
        os.makedirs(log_dir)

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
                    SUM(Itinerary.[Number of People]) AS bc_users,
                    SUM(Itinerary.[Number of People] * Itinerary.[# Nights]) as bc_user_nights 
                FROM Itinerary
                WHERE 
                    Itinerary.[# Nights] IS NOT NULL AND
                    MONTH(Itinerary.[Camp Date])={month} AND
                    YEAR(Itinerary.[Camp Date])={year}
                GROUP BY MONTH(Itinerary.[Camp Date]);'''\
        .format(month=query_month, year=query_year)

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
            data.append(bc_stats.rename(columns={c: c + '_%s' % side for c in bc_stats.columns}))

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
            Year(qryGroupsDates.ActDeparture) = {year}
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
            climbing_stats = {'denali_climber_user_nights': 0,
                              'forkaer_climber_user_nights': 0,
                              'denali_climbers': 0,
                              'foraker_climbers': 0}
        data.append(pd.DataFrame([climbing_stats]))


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
                                        'relativeDate': 'lastmonth',
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
            data.append(
                pd.DataFrame(response_json['results'])\
                    .replace({'name': VEA_LOCATION_NAMES})\
                    .pivot(columns='name', values='sumins')
            )
        except:
            log['errors'].append({'action': 'querying Vea REST API data',
                                  'error': traceback.format_exc()
                                  })


    ###########################################################################################################
    ################################## savage db queries ######################################################
    ###########################################################################################################
    start_date = '{year}-{month}-1'.format(year=query_year, month=query_month)
    end_date = '{year}-{month}-1'.format(year=current_date.year, month=current_date.month)
    sql_template = '''
        SELECT sum(n_passengers) AS {field_name} 
        FROM {table} 
        WHERE datetime BETWEEN '{start}' AND '{end}'
        GROUP BY extract(month FROM datetime)
    '''

    lodge_bus_sql = '''
        SELECT bus_type, sum(n_passengers) n_passengers 
        FROM buses 
        WHERE 
            datetime BETWEEN '{start}' AND '{end}' AND
            bus_type in (SELECT code FROM bus_codes WHERE is_lodge_bus)
        GROUP BY bus_type, extract(month FROM datetime)
    '''.format(start=start_date, end=end_date)
    try:
        engine = sqlalchemy.create_engine(
            'postgresql://{username}:{password}@{ip_address}:{port}/{db_name}'.format(**params['savage_db_credentials'])
        )

        with engine.connect() as conn:
            bikes = pd.read_sql(sql_template.format(field_name='cyclists_past_savage', table='cyclists', start=start_date, end=end_date), conn)
            road_lottery = pd.read_sql(sql_template.format(field_name='road_lottery_passengers', table='road_lottery', start=start_date, end=end_date), conn)
            accessibility = pd.read_sql(sql_template.format(field_name='accessibility_permit_passengers', table='accessibility', start=start_date, end=end_date), conn)
            photographers = pd.read_sql(sql_template.format(field_name='pro_photographers', table='photographers', start=start_date, end=end_date), conn)

            lodge_buses = pd.read_sql(lodge_bus_sql, conn)\
                .replace({'bus_type': LODGE_BUS_FIELDS})\
                .set_index('bus_type')\
                .T\
                .reset_index(drop=True)
        data.extend([bikes, road_lottery, accessibility, photographers, lodge_buses])
    except:
        log['errors'].append({'action': 'querying Savage DB',
                              'error': traceback.format_exc()
                              })

    ###########################################################################################################
    ################################## glacier landings #######################################################
    ###########################################################################################################
    landings_sql = '''
        SELECT sum(n_passengers) AS scenic_landings_south
        FROM flights INNER JOIN landings ON flights.id = landings.flight_id
        WHERE 
            landings.landing_type = 'scenic' AND
            flights.departure_datetime BETWEEN '{start}' AND '{end}' AND
            flights.operator_code <> 'TST' 
        GROUP BY extract(month FROM flights.departure_datetime)
    '''.format(start=start_date, end=end_date)
    try:
        engine = sqlalchemy.create_engine(
            'postgresql://{username}:{password}@{ip_address}:{port}/{db_name}'.format(**params['landings_db_credentials'])
        )
        with engine.connect() as conn:
            data.append(pd.read_sql(landings_sql, conn))
    except:
        log['errors'].append({'action': 'querying landings',
                              'error': traceback.format_exc()
                              })

    try:
        engine = sqlalchemy.create_engine(
            'postgresql://{username}:{password}@{ip_address}:{port}/{db_name}'.format(**params['vistats_db_credentials'])
        )
        with engine.connect() as conn, conn.begin():
            # Insert count_period record
            recordset = conn.execute("INSERT INTO count_periods (count_date) VALUES ('%s') RETURNING id" % start_date)
            result = recordset.fetchall()
            recordset.close()
            if len(result) == 1:
                period_id = result[0][0]
            else:
                raise RuntimeError('Invalid result returned from count_period INSERT statement: %s' % result)

            data = pd.concat(data)
            data['period_id'] = period_id
            data['entered_by'] = os.path.basename(__file__)
            data['submission_time'] = now

            # insert counts
            data.to_sql('counts', conn, index=False, if_exists='append')
    except:
        log['errors'].append({'action': 'importing data',
                              'error': traceback.format_exc()
                              })

    write_log(log, log_dir, now.strftime('%Y%m%d-%H%M'))


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:]))

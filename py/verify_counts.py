import os
import sys
import sqlalchemy
import pandas as pd
from datetime import datetime
from dateutil import relativedelta

import retrieve_data


def main(param_file, out_path, count_year=None):

    params = retrieve_data.read_json_params(param_file)

    dena_engine = sqlalchemy.create_engine(
        'postgresql://{username}:{password}@{ip_address}:{port}/{db_name}'
            .format(**params['vistats_db_credentials'])
    )
    irma_engine = sqlalchemy.create_engine(
        'mssql+pyodbc://{server_name}/{db_name}?driver=SQL Server Native Client 11.0'
            .format(**params["irma_db_credentials"])
    )

    now = datetime.now()
    count_year = count_year if count_year else now.year - 1
    start_date = f'{count_year}-1-1'
    end_date = f'{now.year}-1-1'

    dena_sql = f'''
        SELECT 
            counts.value,
            counts.last_edited_by,
            counts.is_estimated,
            count_periods.count_date,
            value_labels.dena_label,
            value_labels.irma_field_id,
            to_char(count_date, 'YYYY_MM_') || lower(irma_field_id) AS count_id
        FROM
            (counts 
                INNER JOIN value_labels 
                    ON counts.value_label_id = value_labels.id
            ) INNER JOIN count_periods 
                ON counts.period_id = count_periods.id
        WHERE
            irma_field_id IS NOT NULL AND
            count_date BETWEEN '{start_date}' AND '{end_date}'
    '''
    dena_counts = pd.read_sql(dena_sql, dena_engine)\
        .set_index('count_id')
    irma_field_id_str = "', '".join(dena_counts.irma_field_id.unique())
    value_labels = pd.read_sql_table('value_labels', dena_engine)

    irma_sql = f'''
        SELECT 
            Field_Name AS field_id, 
            Field_Name_Value AS value,
            FNV_Collected_Date AS count_date,
            format(FNV_Collected_Date, 'yyyy') +  
                '_' + right('0' + rtrim(month(FNV_Collected_Date)), 2) +  
                '_' + lower(Field_Name) 
                AS count_id
        FROM VIEW_DENA_FieldsAndValues 
        WHERE 
            Field_Name IN ('{irma_field_id_str}') AND
            Field_Name_Value IS NOT NULL AND
            FNV_Collected_Date BETWEEN '{start_date}' AND '{end_date}'
    '''
    irma_counts = pd.read_sql(irma_sql, irma_engine)\
        .set_index('count_id')

    label_ids = pd.read_sql("SELECT id, retrieve_data_label FROM value_labels", dena_engine) \
                .set_index('retrieve_data_label')\
                .id.to_dict()
    recounts = []
    print('Recounting for...')
    for count_month in range(1, 13):
        start_date = f'{count_year}-{count_month}-1'
        start_datetime = datetime.strptime(start_date, '%Y-%m-%d')
        end_datetime = start_datetime + relativedelta.relativedelta(months=1)
        print(f'''\r{start_datetime.strftime('%B')}...''')
        counts = retrieve_data.run_queries(params, {'errors': [], 'messages': []}, start_datetime, end_datetime)
        counts['count_month'] = count_month
        counts.value_label_id = counts.value_label_id.replace(label_ids).astype(int)
        recounts.append(counts)

    recounts = pd.concat(recounts)\
        .merge(value_labels, left_on='value_label_id', right_on='id', how='left')\
        .dropna(subset=['irma_field_id'], inplace=True)
    recounts['count_id'] = [
        f'{count_year}_{row.count_month :0>2}_{row.irma_field_id.lower()}'
        for _, row in recounts.iterrows()
    ]
    recounts.set_index('count_id', inplace=True)

    joined = recounts.join(irma_counts, lsuffix='_dena', rsuffix='_irma') #.join() defaults to joining on index
    joined['diff'] = joined.value_dena - joined.value_irma

    joined.to_csv(out_path)


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:]))
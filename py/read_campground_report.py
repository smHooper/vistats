import os, sys
import calendar
from datetime import datetime
from dateutil import relativedelta
import pandas as pd

SITE_IDS = {
    'PV30XT': 'Riley Creek',
    'PV53XT': 'Riley Creek',
    'PCXXRT': 'Riley Creek tent-only',
    'PVRXGT': 'Riley Creek',
    'PC30XT': 'Savage River',
    'PV53SX': 'Savage River',
    'PVXXGT': 'Savage River',
    'PV53XX': 'Teklanika',
    'PCXXTX': 'Sanctuary',
    'PCXXIT': 'Igloo',
    'PCXXWT': 'Wonder Lake'
}

COLUMNS = ['TYPE1', 'PROPERTY1', 'ARRIVAL', 'DEPART', 'TOTALPAX', 'FEATURE1']

FIELD_NAMES = {
    'Riley Creek tent':     'riley_cg_stays_tent_only',
    'Riley Creek vehicle':  'riley_cg_stays_vehicle',
    'Savage River tent':    'savage_cg_stays_tent_only',
    'Savage River vehicle': 'savage_cg_stays_vehicle',
    'Sanctuary tent':       'sanctuary_cg_stays',
    'Teklanika tent':       'teklanika_cg_stays_tent_only',
    'Teklanika vehicle':    'teklanika_cg_stays_vehicle',
    'Igloo tent':           'igloo_cg_stays',
    'Wonder Lake tent':     'wonder_lake_cg_stays'
}

def main(path, count_date):

    _, ext = os.path.splitext(path)
    filename = os.path.basename(path)
    ext = ext.lower()

    try:
        if ext == '.csv':
            data = pd.read_csv(path, encoding='ISO-8859-1')
        elif ext.startswith('.xls'):
            excel_doc = pd.ExcelFile(path)
            data = excel_doc.parse(excel_doc.sheet_names[0])
        else:
            raise IOError(f'Could not read "{filename}" because the file extension was {ext}. Must be either .csv, .xsl, or .xlsx')
    except Exception as e:
        raise IOError(f'Could not read file "{filename}" because {e}')

    missing_cols = [c for c in COLUMNS if c not in data.columns]
    if len(missing_cols):
        raise RuntimeError('The file "{filename}" is missing the following necessary columns: {columns}'
                           .format(filename=filename, columns=', '.join(missing_cols))
                           )

    # Define site. There are two different codes for Riley and Savage vehicle sites because one is for small
    #   vehicles and the other is for large ones.
    data['site'] = data.TYPE1.replace(SITE_IDS)

    # Define the site type (vehicle or tent). It's apparently incumbent on the reservation agent to fill out a
    #   non-requried field to indicate if the campers using the site do or do not have a vehicle, so many get left
    #   blank. The vast majority of campers arrive in their own vehicle though so it's safe to assume any null values
    #   represent vehicle sites
    data['site_type'] = data.FEATURE1\
        .replace({'RA': 'vehicle', 'TA': 'tent'})\
        .fillna('vehicle')
    data.loc[data.site.isin(['Riley Creek tent-only', 'Sanctuary', 'Igloo', 'Wonder Lake']),  'site_type'] = 'tent'
    data.loc[(data.site == 'Riley Creek tent-only'), 'site'] = 'Riley Creek'
    data.loc[data.site.isin(['Riley Creek group', 'Savage River group']), 'site_type'] = 'vehicle'

    # Some reservations start in the previous month or end in the next month, so calculate the number of actual days
    #   for each reservation within this month
    try:
        count_datetime = pd.to_datetime(count_date)
    except:
        raise RuntimeError(f'Could not parse {count_date} into a proper datetime')

    count_year = count_datetime.year
    count_month = count_datetime.month
    month_start = datetime(count_year, count_month, 1)
    last_month_day = calendar.monthrange(count_year, count_month)[1]
    month_end = datetime(count_year, count_month, last_month_day) + relativedelta.relativedelta(days=1)
    try:
        data.ARRIVAL = pd.to_datetime(data.ARRIVAL)
        data.DEPART = pd.to_datetime(data.DEPART)
    except:
        raise RuntimeError('could not understand datetime format of ARRIVAL or DEPART column')
    data.loc[data.ARRIVAL == data.DEPART, 'DEPART'] += pd.Timedelta(days=1)
    data['start_date'] = [max(d, month_start) for d in data.ARRIVAL]
    data['end_date'] = [min(d, month_end) for d in data.DEPART]
    data['nights'] = (data.end_date - data.start_date).dt.days
    data = data.loc[data.nights > 1]

    # Group by site and site type to get counts for each field of interest, then clean up:
    #   1. groupby on two columns creates a multi-index, so reset_index() to get site and site_type as columns
    #   2. melt unpivots to get a row for each value in tent and vehicle column counts
    #   3. drop any null values (where tent or vehicle site doesn't apply)
    counts = data.groupby(['site', 'site_type']).nights.sum()\
        .reset_index()\
        .melt(id_vars='site', value_vars=['tent', 'vehicle'])\
        .dropna(subset=['value'])
    # Turn site + site_type into retrieve_data labels so the web app knows what fields the values belong to
    counts.site_type = counts.site + ' ' + counts.site_type
    counts['retrieve_data_label'] = counts.site_type.replace(FIELD_NAMES)
    counts.drop(columns=['site', 'site_type'], inplace=True)
    json_str = counts.drop(columns=['site', 'site_type']).T.to_json()

    return json_str


if __name__ == '__main__':
    sys.exit(main(*sys.argv[:1]))

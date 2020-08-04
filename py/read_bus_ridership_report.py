import os, sys
import calendar
from datetime import datetime
from dateutil import relativedelta
import pandas as pd


BUS_TYPE_SEARCH_STRS = {'twt_bus_passengers':               ['twt', 'tundra wilderness tour'],
                        'ke_bus_passengers':                ['kantishna', 'ke', 'experience'],
                        'dnht_bus_passengers':              ['history', 'dnht'],
                        'transit_bus_passengers':           ['vts', 'transit'],
                        'tek_bus_passengers':               ['tek', 'teklanika'],
                        'savage_river_shuttle_passengers':  ['savage'],
                        'riley_creek_shuttle_passengers':   ['riley']
                        }


def main(path, count_date):

    _, ext = os.path.splitext(path)
    filename = os.path.basename(path)
    ext = ext.lower()

    try:
        if ext.startswith('.xls'):#'''
            excel_doc = pd.ExcelFile(path)
        else:
            raise IOError(f'Could not read "{filename}" because the file extension was {ext}. Must be either .xsl or .xlsx')
    except Exception as e:
        raise IOError(f'Could not read file "{filename}" because {e}')

    try:
        count_datetime = pd.to_datetime(count_date)
    except:
        raise RuntimeError(f'Could not parse {count_date} into a proper datetime')

    count_year = count_datetime.year
    count_month = count_datetime.month
    month_start = datetime(count_year, count_month, 1)

    data = {}
    for sheet_name in excel_doc.sheet_names:
        sheet = excel_doc.parse(sheet_name)
        if len(sheet.columns) < 3:
            raise RuntimeError(f'Could not read sheet {sheet_name} because 3 columns were expected but '
                               f'{len(sheet.columns)} found')

        # It doesn't look like column names will necessarily be consistent, so try to use column positions
        date_col, _, count_col = sheet.columns[:3]

        # Remove any records that are not for this month (in case any were accidentally included)
        sheet = sheet.loc[(sheet[date_col] >= month_start) &
                          (sheet[date_col] < month_start + relativedelta.relativedelta(months=1))]

        count = sheet[count_col].sum()

        # Look for a sheet specifically for tek first. If one exists, it will likely have VTS or transit in the name
        #   as well, so it could be confused with generally VTS numbers
        if any([s in sheet_name.lower() for s in BUS_TYPE_SEARCH_STRS['tek_bus_passengers']]):
            data['tek_bus_passengers'] = count

        # The transit sheet might have tek passenger totals, so check if that's the case and process accordingly
        elif any([s in sheet_name.lower() for s in BUS_TYPE_SEARCH_STRS['transit_bus_passengers']]):
            if len(sheet.columns) > 3:
                # Tek count should be total passengers at tek where as other count col should be count at Savage
                tek_count_col = sheet.columns[3]
                try:
                    data['tek_bus_passengers'] = (sheet[tek_count_col] - sheet[count_col]).sum()
                except Exception as e:
                    raise RuntimeError(f'Could not calculate passengers loading at Tek because of the following error:'
                                       f' {e}. The script expected Savage pax counts and Tek pax counts to be the 3rd'
                                       f' and 4th columns, respectively')

            data['transit_bus_passengers'] = count

        # Otherwise, loop through the search strs for each bus type and look for each of them in the sheet name
        else:
            n_counts = len(data)
            for bus_type, search_strs in BUS_TYPE_SEARCH_STRS.items():
                if bus_type in ['tek_bus_passengers', 'transit_bus_passengers']:
                    continue #already processed so skip them
                if any([s in sheet_name.lower() for s in search_strs]):
                    data[bus_type] = count

            # Check if there was a sheet_name match by seeing if there was a new count added to the data dict
            if n_counts == len(data):
                import pdb; pdb.set_trace()
                raise RuntimeError(f'Bus type could not be extracted from sheet {sheet_name}')

    last_month_day = calendar.monthrange(count_year, count_month)[1]
    month_end = datetime(count_year, count_month, last_month_day)
    data = pd.DataFrame({'value': pd.Series(data)})
    if (data.value == 0).all():
        raise RuntimeError(f'No bus passengers were found in this file for {month_start.strftime("%b %d, %Y")} and {month_end.strftime("%b %d, %Y")}')

    json_str = data\
        .rename_axis('retrieve_data_label')\
        .reindex(index=BUS_TYPE_SEARCH_STRS.keys())\
        .value.fillna(0)\
        .astype(int)\
        .to_json()

    #print(json_str) # need to send it to stdout for php to receive it

    return json_str


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:]))

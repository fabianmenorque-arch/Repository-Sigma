def test_cantidad_negativa():

    dataframe = dataframe_base()

    dataframe.loc[0, "Cant. Unit."] = -1

    processor = DataProcessor()

    result = processor.process(dataframe)

    assert len(result.errors) == 1

    issue = result.errors[0]

    assert issue.campo == "Cant. Unit."

    assert issue.severidad is Severity.ERROR

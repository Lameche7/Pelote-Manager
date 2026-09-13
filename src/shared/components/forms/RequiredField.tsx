type RequiredFieldMarkProps = {
  title?: string;
};

export function RequiredFieldMark({
  title = "Champ obligatoire",
}: RequiredFieldMarkProps) {
  return (
    <span className="required-field-mark" aria-hidden="true" title={title}>
      *
    </span>
  );
}

type RequiredFieldsNoticeProps = {
  text?: string;
};

export function RequiredFieldsNotice({
  text = "Champs obligatoires",
}: RequiredFieldsNoticeProps) {
  return (
    <p className="required-fields-notice">
      <span className="required-field-mark" aria-hidden="true">
        *
      </span>{" "}
      {text}
    </p>
  );
}

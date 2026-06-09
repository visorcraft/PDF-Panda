use lopdf::Document;
use std::path::Path;

/// Load a PDF, run `f`, save back to the same path, and return `f`'s result.
pub fn mutate_pdf<T, F>(path: &Path, f: F) -> Result<T, String>
where
    F: FnOnce(&mut Document) -> Result<T, String>,
{
    let mut doc = Document::load(path).map_err(|e| e.to_string())?;
    let result = f(&mut doc)?;
    doc.save(path).map_err(|e| e.to_string())?;
    Ok(result)
}

/// Return the number of pages without mutating the file.
pub fn page_count(path: &Path) -> Result<usize, String> {
    Document::load(path).map_err(|e| e.to_string()).map(|doc| doc.get_pages().len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{Dictionary, Object, Stream};
    use std::fs;

    fn minimal_pdf(path: &Path) {
        let mut doc = Document::with_version("1.4");
        let pages_id = doc.new_object_id();
        let page_id = doc.new_object_id();
        let content_id = doc.new_object_id();
        doc.objects.insert(content_id, Object::Stream(Stream::new(Dictionary::new(), b"BT ET".to_vec())));
        let mut page = Dictionary::new();
        page.set("Type", Object::Name(b"Page".to_vec()));
        page.set("Parent", Object::Reference(pages_id));
        page.set("MediaBox", Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]));
        page.set("Contents", Object::Reference(content_id));
        doc.objects.insert(page_id, Object::Dictionary(page));
        let mut pages = Dictionary::new();
        pages.set("Type", Object::Name(b"Pages".to_vec()));
        pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
        pages.set("Count", Object::Integer(1));
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let mut catalog = Dictionary::new();
        catalog.set("Type", Object::Name(b"Catalog".to_vec()));
        catalog.set("Pages", Object::Reference(pages_id));
        let catalog_id = doc.add_object(Object::Dictionary(catalog));
        doc.trailer.set("Root", Object::Reference(catalog_id));
        doc.save(path).unwrap();
    }

    #[test]
    fn page_count_reads_without_mutation() {
        let dir = std::env::temp_dir().join("pdf_panda_io_test");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("count.pdf");
        minimal_pdf(&path);
        assert_eq!(page_count(&path).unwrap(), 1);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn mutate_pdf_skips_save_on_closure_error() {
        let dir = std::env::temp_dir().join("pdf_panda_io_test");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("mutate_err.pdf");
        minimal_pdf(&path);
        let before = fs::read(&path).unwrap();
        let err = mutate_pdf::<(), _>(&path, |doc| {
            let page_id = *doc.get_pages().get(&1).unwrap();
            doc.get_dictionary_mut(page_id)
                .unwrap()
                .set("Rotate", Object::Integer(90));
            Err("intentional failure".into())
        })
        .unwrap_err();
        assert_eq!(err, "intentional failure");
        assert_eq!(fs::read(&path).unwrap(), before);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn mutate_pdf_persists_changes() {
        let dir = std::env::temp_dir().join("pdf_panda_io_test");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("mutate.pdf");
        minimal_pdf(&path);
        mutate_pdf(&path, |doc| {
            let page_id = *doc.get_pages().get(&1).unwrap();
            doc.get_dictionary_mut(page_id).unwrap().set("Rotate", Object::Integer(90));
            Ok(())
        })
        .unwrap();
        let doc = Document::load(&path).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let rot = doc.get_dictionary(page_id).unwrap().get(b"Rotate").unwrap().as_i64().unwrap();
        assert_eq!(rot, 90);
        let _ = fs::remove_file(&path);
    }
}

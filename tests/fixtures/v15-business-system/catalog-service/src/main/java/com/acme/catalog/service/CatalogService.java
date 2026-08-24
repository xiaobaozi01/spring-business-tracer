package com.acme.catalog.service;

import com.acme.catalog.mapper.CatalogMapper;
import org.springframework.stereotype.Service;

@Service
public class CatalogService {
    private final CatalogMapper mapper;
    public CatalogService(CatalogMapper mapper) { this.mapper = mapper; }
    public String find(String sku) { return mapper.findName(sku); }
    public void refresh() { mapper.markActive(); }
}

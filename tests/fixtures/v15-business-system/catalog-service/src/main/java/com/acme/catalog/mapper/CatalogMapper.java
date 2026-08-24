package com.acme.catalog.mapper;

import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

public interface CatalogMapper {
    @Select("select name from catalog.product where sku = #{sku}")
    String findName(String sku);
    @Update("update catalog.product set active = true")
    int markActive();
}
